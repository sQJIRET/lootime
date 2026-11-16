import crypto from 'node:crypto';
import { getSettings } from '../db.js';
import { now, rateLimiter } from './util.js';

const NICK_RE = /^[A-Za-z0-9_.]{3,17}$/;
const METHOD_NAMES = { 2: 'СБП', 10: 'Карты РФ', 11: 'Банковская карта', 12: 'Международная карта', 13: 'Криптовалюта' };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MAX_CART_ITEMS = 20;

/** Витрина, промокод, оформление заказа и статус заказа. */
export function shopRoutes(router, { db, config, platega }) {
  const allowCheckout = rateLimiter(10, 10 * 60_000);

  // ---------------------------------------------------------------- витрина

  function publicProduct(p) {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      image_url: p.image_url,
      price: p.price_kop / 100,
      unit: p.unit || '',
      group_name: p.group_name || '',
      period: p.period || '',
      allow_qty: Boolean(p.allow_qty),
      qty_min: p.qty_min,
      qty_max: p.qty_max,
      price_per: p.price_per || 1,
    };
  }

  router.get('/shop', (req, res) => {
    const s = getSettings(db);
    const products = db
      .prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort ASC, id ASC')
      .all()
      .map(publicProduct);
    const methods = config.paymentMethods.map((id) => ({ id, name: METHOD_NAMES[id] ?? `Метод ${id}` }));
    res.json({ settings: s, products, methods, dev: config.devMode });
  });

  const allowPromo = rateLimiter(30, 10 * 60_000);

  /** Разобрать корзину из запроса и посчитать суммы. Возвращает { error } или данные заказа. */
  function buildCart(body) {
    let raw = Array.isArray(body?.items) ? body.items : [];
    if (!raw.length && body?.productId != null) raw = [{ productId: body.productId, qty: body.qty }];
    if (!raw.length) return { error: 'Корзина пуста', status: 400 };
    if (raw.length > MAX_CART_ITEMS) return { error: 'Слишком много товаров в корзине', status: 400 };

    const merged = new Map();
    const lines = [];
    let subtotal = 0;
    for (const it of raw) {
      const id = Number(it?.productId);
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
      if (!product) return { error: 'Один из товаров больше недоступен. Обновите страницу', status: 404 };
      if (merged.has(id)) return { error: 'Товар указан в корзине дважды', status: 400 };
      merged.set(id, true);
      let q = 1;
      if (product.allow_qty) {
        q = Math.floor(Number(it?.qty));
        if (!Number.isFinite(q) || q < product.qty_min || q > product.qty_max) {
          return { error: `«${product.name}»: количество от ${product.qty_min} до ${product.qty_max}`, status: 400 };
        }
      }
      const lineKop = Math.round((product.price_kop * q) / (product.price_per || 1));
      lines.push({ product_id: product.id, name: product.name, qty: q, price_kop: product.price_kop });
      subtotal += lineKop;
    }

    const promo = String(body?.promo ?? '').trim().toUpperCase();
    let percent = 0;
    if (promo) {
      percent = config.promos?.[promo] ?? 0;
      if (!percent) return { error: 'Промокод не найден', status: 400 };
    }
    const discount = Math.round((subtotal * percent) / 100);
    return { lines, subtotal, discount, total: subtotal - discount, promo: percent ? promo : '', percent };
  }

  router.post('/promo', (req, res) => {
    if (!allowPromo(req.ip)) return res.status(429).json({ error: 'Слишком много попыток' });
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    const percent = config.promos?.[code] ?? 0;
    if (!percent) return res.status(404).json({ error: 'Промокод не найден' });
    res.json({ code, percent });
  });

  router.post('/checkout', async (req, res) => {
    if (!allowCheckout(req.ip)) return res.status(429).json({ error: 'Слишком много попыток, подождите несколько минут' });

    const { nick, method, email } = req.body ?? {};
    const cleanNick = String(nick ?? '').trim();
    if (!NICK_RE.test(cleanNick)) {
      return res.status(400).json({ error: 'Ник: 3–16 символов, латинские буквы, цифры и _' });
    }
    const cleanEmail = String(email ?? '').trim();
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'Укажите корректный email для отправки чека' });
    if (req.body?.consentPd !== true) {
      return res.status(400).json({ error: 'Необходимо согласие на обработку персональных данных' });
    }
    if (req.body?.consentTerms !== true) {
      return res.status(400).json({ error: 'Необходимо принять Пользовательское соглашение' });
    }

    const cart = buildCart(req.body);
    if (cart.error) return res.status(cart.status).json({ error: cart.error });

    const methodId = Number(method ?? config.paymentMethods[0]);
    if (!config.devMode && !config.paymentMethods.includes(methodId)) {
      return res.status(400).json({ error: 'Этот способ оплаты недоступен' });
    }

    const amountKop = cart.total;
    if (amountKop < 100) return res.status(400).json({ error: 'Сумма слишком мала' });

    const orderId = crypto.randomUUID();
    const productTitle = cart.lines.map((l) => (l.qty > 1 ? `${l.name} x${l.qty}` : l.name)).join(', ').slice(0, 300);
    db.prepare(
      `INSERT INTO orders(id, nick, product_id, product_name, qty, amount_kop, status, method, created_at,
                          items, email, promo, discount_kop, consent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      orderId,
      cleanNick,
      cart.lines[0].product_id,
      productTitle,
      cart.lines.reduce((n, l) => n + l.qty, 0),
      amountKop,
      methodId,
      now(),
      JSON.stringify(cart.lines.map((l) => ({ product_id: l.product_id, qty: l.qty }))),
      cleanEmail,
      cart.promo,
      cart.discount,
      now(),
    );

    if (config.devMode && !platega.enabled) {
      return res.json({ orderId, redirect: `/dev/pay/${orderId}` });
    }
    if (!platega.enabled) {
      db.prepare("UPDATE orders SET status = 'canceled', note = 'Platega не настроена' WHERE id = ?").run(orderId);
      return res.status(503).json({ error: 'Оплата временно недоступна' });
    }

    try {
      const t = await platega.createTransaction({
        method: methodId,
        amountRub: amountKop / 100,
        description: `${productTitle} для ${cleanNick}`.slice(0, 200),
        returnUrl: `${config.publicUrl}/?order=${orderId}`,
        failedUrl: `${config.publicUrl}/?order=${orderId}&failed=1`,
        orderId,
      });
      db.prepare('UPDATE orders SET transaction_id = ? WHERE id = ?').run(t.transactionId, orderId);
      res.json({ orderId, redirect: t.redirect });
    } catch (e) {
      console.error('[checkout] Platega error:', e.message, e.body ?? '');
      db.prepare("UPDATE orders SET status = 'canceled', note = ? WHERE id = ?").run(
        String(e.message).slice(0, 200),
        orderId,
      );
      res.status(502).json({ error: 'Не удалось создать платёж. Попробуйте позже' });
    }
  });

  router.get('/order/:id', (req, res) => {
    const o = db.prepare('SELECT id, nick, product_name, qty, status FROM orders WHERE id = ?').get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Заказ не найден' });
    const d = db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(status = 'done') AS done FROM deliveries WHERE order_id = ?`,
      )
      .get(o.id);
    res.json({
      id: o.id,
      nick: o.nick,
      product: o.product_name,
      qty: o.qty,
      status: o.status,
      delivered: d.total > 0 && d.done === d.total,
    });
  });
}
