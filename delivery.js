import { tx } from '../db.js';
import { now } from './util.js';

const fmtNum = (n) => new Intl.NumberFormat('ru-RU').format(n).replace(/\u00a0|\u202f/g, ' ');

/** Красивое сообщение в чат: «игрок задонатил». Выполняется консолью сервера как обычная команда выдачи. */
function announceCommand(nick, found) {
  if (process.env.ANNOUNCE_ENABLED === '0') return '';
  const server = (process.env.ANNOUNCE_NAME ?? 'LoonTime').trim() || 'LoonTime';
  const items = found
    .map(({ product, qty }) => (product.allow_qty && (qty > 1 || product.price_per > 1) ? `${product.name} ×${fmtNum(qty)}` : product.name))
    .join(', ');
  const parts = [
    '\n',
    { text: '  ❖ ', color: '#FFB800' },
    { text: 'НОВЫЙ ДОНАТ', bold: true, color: '#FFD54A' },
    { text: ' ❖', color: '#FFB800' },
    '\n',
    { text: '  ➤ ', color: '#8A8A8A' },
    { text: nick, bold: true, color: '#55FF88' },
    { text: ' приобрёл ', color: '#E6E6E6' },
    { text: items, bold: true, color: '#FFD54A' },
    '\n',
    { text: `  ♥ Спасибо за поддержку ${server}!`, color: '#FF6B9D' },
    '\n',
  ];
  return 'tellraw @a ' + JSON.stringify(parts);
}

/** Пометить заказ оплаченным и создать задачи на выдачу. Идемпотентно. */
export function createMarkPaid(db) {
  return function markPaid(orderId, { transactionId } = {}) {
  return tx(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status === 'paid') return { ok: true, already: true, order };

    // состав заказа: корзина (items) или один товар (старые заказы)
    let lines = [];
    try {
      lines = order.items ? JSON.parse(order.items) : [];
    } catch {
      lines = [];
    }
    if (!lines.length) lines = [{ product_id: order.product_id, qty: order.qty }];
    const found = lines.map((l) => ({
      qty: l.qty,
      product: db.prepare('SELECT * FROM products WHERE id = ?').get(l.product_id),
    }));
    if (found.some((f) => !f.product)) return { ok: false, reason: 'product_gone' };

    db.prepare(
      "UPDATE orders SET status = 'paid', paid_at = ?, transaction_id = COALESCE(?, transaction_id) WHERE id = ?",
    ).run(now(), transactionId ?? null, orderId);

    const ins = db.prepare(
      'INSERT INTO deliveries(order_id, nick, command, online_only, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const { product, qty } of found) {
      const cmds = JSON.parse(product.commands || '[]');
      for (const raw of cmds) {
        const cmd = String(raw)
          .replaceAll('{player}', order.nick)
          .replaceAll('{qty}', String(qty))
          .replace(/\{qty\*(\d+)\}/g, (_, k) => String(qty * Number(k)))
          .replace(/^\//, '')
          .trim();
        if (cmd) ins.run(orderId, order.nick, cmd, product.online_only, now());
      }
    }
    const announce = announceCommand(order.nick, found);
    if (announce) ins.run(orderId, order.nick, announce, 0, now());
    return { ok: true, already: false, order };
  });
}
}
