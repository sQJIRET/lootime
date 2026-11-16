import crypto from 'node:crypto';
import { getSettings, setSettings, tx } from '../db.js';
import { now, rateLimiter, safeEqual } from './util.js';
import { ticketAdminRoutes } from './tickets.js';

/** API админки: вход, товары, заказы, статистика, настройки. */
export function adminRoutes(router, { db, config, markPaid }) {
  const allowLogin = rateLimiter(8, 10 * 60_000);

  const sign = (data) => crypto.createHmac('sha256', config.sessionSecret).update(data).digest('hex');

  function parseCookies(req) {
    const out = {};
    for (const part of (req.get('Cookie') ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function isAdmin(req) {
    const c = parseCookies(req).lt_admin;
    if (!c) return false;
    const [exp, sig] = c.split('.');
    if (!exp || !sig || Number(exp) < now()) return false;
    return safeEqual(sig, sign(exp));
  }

  function adminAuth(req, res, next) {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Требуется вход' });
    next();
  }

  router.post('/admin/login', (req, res) => {
    if (!allowLogin(req.ip)) return res.status(429).json({ error: 'Слишком много попыток входа' });
    if (!config.adminPassword || !safeEqual(req.body?.password, config.adminPassword)) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    const exp = String(now() + 12 * 3600_000);
    const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `lt_admin=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${secure}`,
    );
    res.json({ ok: true });
  });

  router.post('/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'lt_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  router.get('/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));

  ticketAdminRoutes(router, { db }, adminAuth);

  function parseProductInput(b) {
    const name = String(b?.name ?? '').trim();
    if (!name) throw new Error('Укажите название');
    const price = Number(b?.price);
    if (!Number.isFinite(price) || price < 1) throw new Error('Цена должна быть не меньше 1 ₽');
    const allowQty = b?.allow_qty ? 1 : 0;
    const qtyMin = Math.max(1, Math.floor(Number(b?.qty_min) || 1));
    const qtyMax = Math.max(qtyMin, Math.floor(Number(b?.qty_max) || qtyMin));
    const pricePer = Math.max(1, Math.floor(Number(b?.price_per) || 1));
    const commands = (Array.isArray(b?.commands) ? b.commands : String(b?.commands ?? '').split('\n'))
      .map((c) => String(c).trim())
      .filter(Boolean);
    if (commands.length === 0) throw new Error('Добавьте хотя бы одну команду выдачи');
    return {
      name: name.slice(0, 100),
      description: String(b?.description ?? '').slice(0, 2000),
      category: String(b?.category ?? '').trim().slice(0, 50) || 'Прочее',
      image_url: String(b?.image_url ?? '').trim().slice(0, 500),
      price_kop: Math.round(price * 100),
      allow_qty: allowQty,
      qty_min: qtyMin,
      qty_max: qtyMax,
      price_per: pricePer,
      commands: JSON.stringify(commands),
      online_only: b?.online_only ? 1 : 0,
      active: b?.active === false || b?.active === 0 ? 0 : 1,
      sort: Math.floor(Number(b?.sort) || 0),
    };
  }

  const adminProduct = (p) => ({
    ...publicProduct(p),
    commands: JSON.parse(p.commands || '[]'),
    online_only: Boolean(p.online_only),
    active: Boolean(p.active),
    sort: p.sort,
  });

  router.get('/admin/products', adminAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM products ORDER BY sort ASC, id ASC').all().map(adminProduct));
  });

  router.post('/admin/products', adminAuth, (req, res) => {
    try {
      const v = parseProductInput(req.body);
      const r = db
        .prepare(
          `INSERT INTO products(name, description, category, image_url, price_kop, allow_qty, qty_min, qty_max, price_per, commands, online_only, active, sort)
           VALUES (@name, @description, @category, @image_url, @price_kop, @allow_qty, @qty_min, @qty_max, @price_per, @commands, @online_only, @active, @sort)`,
        )
        .run(v);
      res.json({ id: Number(r.lastInsertRowid) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.put('/admin/products/:id', adminAuth, (req, res) => {
    try {
      const v = parseProductInput(req.body);
      const r = db
        .prepare(
          `UPDATE products SET name=@name, description=@description, category=@category, image_url=@image_url,
             price_kop=@price_kop, allow_qty=@allow_qty, qty_min=@qty_min, qty_max=@qty_max, price_per=@price_per, commands=@commands,
             online_only=@online_only, active=@active, sort=@sort WHERE id=@id`,
        )
        .run({ ...v, id: Number(req.params.id) });
      if (!r.changes) return res.status(404).json({ error: 'Товар не найден' });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.delete('/admin/products/:id', adminAuth, (req, res) => {
    const id = Number(req.params.id);
    const used = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE product_id = ?').get(id).c;
    if (used > 0) {
      // есть история заказов: прячем с витрины вместо удаления
      db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
      return res.json({ ok: true, hidden: true });
    }
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.get('/admin/orders', adminAuth, (req, res) => {
    const status = String(req.query.status ?? '');
    const q = String(req.query.q ?? '').trim();
    const where = [];
    const args = [];
    if (status) {
      where.push('o.status = ?');
      args.push(status);
    }
    if (q) {
      where.push('(o.nick LIKE ? OR o.id LIKE ?)');
      args.push(`%${q}%`, `${q}%`);
    }
    const rows = db
      .prepare(
        `SELECT o.*,
           (SELECT COUNT(*) FROM deliveries d WHERE d.order_id = o.id) AS d_total,
           (SELECT COUNT(*) FROM deliveries d WHERE d.order_id = o.id AND d.status = 'done') AS d_done,
           (SELECT MAX(error) FROM deliveries d WHERE d.order_id = o.id) AS d_error
         FROM orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY o.created_at DESC LIMIT 200`,
      )
      .all(...args);
    res.json(rows.map((o) => ({ ...o, amount: o.amount_kop / 100 })));
  });

  // Выдать вручную / подтвердить заказ на проверке
  router.post('/admin/orders/:id/grant', adminAuth, (req, res) => {
    const r = markPaid(req.params.id);
    if (!r.ok) return res.status(404).json({ error: 'Не удалось выдать: ' + r.reason });
    res.json({ ok: true, already: r.already });
  });

  // Повторить выдачу: все команды заказа снова в очередь
  router.post('/admin/orders/:id/redeliver', adminAuth, (req, res) => {
    const r = db
      .prepare(
        "UPDATE deliveries SET status = 'pending', attempts = 0, next_try = 0, error = '', done_at = NULL WHERE order_id = ?",
      )
      .run(req.params.id);
    res.json({ ok: true, count: Number(r.changes) });
  });

  router.get('/admin/stats', adminAuth, (req, res) => {
    const s = db
      .prepare(
        `SELECT COUNT(*) AS orders, COALESCE(SUM(amount_kop), 0) AS revenue_kop FROM orders WHERE status = 'paid'`,
      )
      .get();
    const pend = db.prepare("SELECT COUNT(*) AS c FROM deliveries WHERE status != 'done'").get().c;
    const openTickets = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status = 'open'").get().c;
    res.json({ paid_orders: s.orders, revenue: s.revenue_kop / 100, undelivered: pend, open_tickets: openTickets });
  });

  router.get('/admin/settings', adminAuth, (req, res) => res.json(getSettings(db)));
  router.put('/admin/settings', adminAuth, (req, res) => {
    setSettings(db, req.body ?? {});
    res.json({ ok: true });
  });
}
