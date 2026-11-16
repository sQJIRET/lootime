import crypto from 'node:crypto';
import { tx } from '../db.js';
import { now, rateLimiter, safeEqual } from './util.js';

const NICK_RE = /^[A-Za-z0-9_.]{3,17}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const CATEGORIES = {
  payment: 'Оплата / донат',
  delivery: 'Не выдан товар',
  ban: 'Бан / мут / разбан',
  bug: 'Ошибка / баг',
  other: 'Другое',
};
const MAX_MESSAGES = 200;
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newId(db) {
  for (let i = 0; i < 20; i++) {
    let s = 'T-';
    for (let j = 0; j < 6; j++) s += ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(s)) return s;
  }
  throw new Error('не удалось создать номер обращения');
}

const clean = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

function publicTicket(db, t) {
  const messages = db
    .prepare('SELECT author, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id')
    .all(t.id);
  return {
    id: t.id,
    nick: t.nick,
    category: t.category,
    category_name: CATEGORIES[t.category] ?? CATEGORIES.other,
    subject: t.subject,
    order_id: t.order_id,
    status: t.status,
    created_at: t.created_at,
    updated_at: t.updated_at,
    messages,
  };
}

/** Публичные маршруты: создать обращение, прочитать по секретной ссылке, ответить, закрыть. */
export function ticketRoutes(router, { db }) {
  const allowCreate = rateLimiter(5, 60 * 60_000);
  const allowReply = rateLimiter(30, 60 * 60_000);
  const allowRead = rateLimiter(120, 10 * 60_000);

  const tokenOf = (req) => String(req.get('X-Ticket-Token') ?? req.query?.token ?? req.body?.token ?? '');

  function load(req, res) {
    if (!allowRead(req.ip)) {
      res.status(429).json({ error: 'Слишком много запросов, подождите немного' });
      return null;
    }
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(String(req.params.id ?? '').toUpperCase());
    if (!t || !safeEqual(t.token, tokenOf(req))) {
      res.status(404).json({ error: 'Обращение не найдено. Проверьте ссылку.' });
      return null;
    }
    return t;
  }

  router.get('/tickets/categories', (req, res) => res.json(CATEGORIES));

  router.post('/tickets', (req, res) => {
    if (!allowCreate(req.ip)) return res.status(429).json({ error: 'Слишком много обращений, попробуйте позже' });
    const b = req.body ?? {};
    const nick = clean(b.nick, 17);
    const email = clean(b.email, 254);
    const subject = clean(b.subject, 100);
    const message = clean(b.message, 4000);
    const category = Object.hasOwn(CATEGORIES, b.category) ? b.category : 'other';
    let orderId = clean(b.order_id, 64) || null;

    if (!NICK_RE.test(nick)) return res.status(400).json({ error: 'Ник: 3–17 символов, латинские буквы, цифры, _ и .' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Укажите корректный email' });
    if (subject.length < 3) return res.status(400).json({ error: 'Укажите тему обращения' });
    if (message.length < 10) return res.status(400).json({ error: 'Опишите проблему подробнее (минимум 10 символов)' });
    if (b.consentPd !== true) return res.status(400).json({ error: 'Необходимо согласие на обработку персональных данных' });
    if (orderId && !db.prepare('SELECT 1 FROM orders WHERE id = ?').get(orderId)) {
      return res.status(400).json({ error: 'Заказ с таким номером не найден. Оставьте поле пустым, если не уверены.' });
    }
    if (!orderId) orderId = null;

    const token = crypto.randomBytes(16).toString('hex');
    const t = now();
    const id = tx(db, () => {
      const tid = newId(db);
      db.prepare(
        'INSERT INTO tickets(id, token, nick, email, category, subject, order_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(tid, token, nick, email, category, subject, orderId, 'open', t, t);
      db.prepare('INSERT INTO ticket_messages(ticket_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(tid, 'user', message, t);
      return tid;
    });
    res.json({ ok: true, id, token });
  });

  router.get('/tickets/:id', (req, res) => {
    const t = load(req, res);
    if (t) res.json(publicTicket(db, t));
  });

  router.post('/tickets/:id/reply', (req, res) => {
    const t = load(req, res);
    if (!t) return;
    if (!allowReply(req.ip)) return res.status(429).json({ error: 'Слишком много сообщений, подождите' });
    if (t.status === 'closed') return res.status(400).json({ error: 'Обращение закрыто. Создайте новое, если проблема осталась.' });
    const message = clean(req.body?.message, 4000);
    if (message.length < 2) return res.status(400).json({ error: 'Напишите сообщение' });
    const count = db.prepare('SELECT COUNT(*) AS c FROM ticket_messages WHERE ticket_id = ?').get(t.id).c;
    if (count >= MAX_MESSAGES) return res.status(400).json({ error: 'В обращении слишком много сообщений. Создайте новое.' });
    const ts = now();
    tx(db, () => {
      db.prepare('INSERT INTO ticket_messages(ticket_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(t.id, 'user', message, ts);
      db.prepare("UPDATE tickets SET status = 'open', updated_at = ? WHERE id = ?").run(ts, t.id);
    });
    res.json(publicTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(t.id)));
  });

  router.post('/tickets/:id/close', (req, res) => {
    const t = load(req, res);
    if (!t) return;
    db.prepare("UPDATE tickets SET status = 'closed', updated_at = ? WHERE id = ?").run(now(), t.id);
    res.json(publicTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(t.id)));
  });
}

/** Маршруты админки: список, чтение, ответ, смена статуса, удаление. adminAuth передаётся из admin.js. */
export function ticketAdminRoutes(router, { db }, adminAuth) {
  router.get('/admin/tickets', adminAuth, (req, res) => {
    const where = [];
    const args = [];
    const status = String(req.query.status ?? '');
    if (['open', 'answered', 'closed'].includes(status)) {
      where.push('t.status = ?');
      args.push(status);
    }
    const q = String(req.query.q ?? '').trim();
    if (q) {
      where.push('(t.nick LIKE ? OR t.id LIKE ? OR t.subject LIKE ? OR t.email LIKE ?)');
      args.push(`%${q}%`, `${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = db
      .prepare(
        `SELECT t.id, t.nick, t.email, t.category, t.subject, t.order_id, t.status, t.created_at, t.updated_at,
           (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages
         FROM tickets t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, t.updated_at DESC LIMIT 300`,
      )
      .all(...args);
    res.json(rows.map((r) => ({ ...r, category_name: CATEGORIES[r.category] ?? CATEGORIES.other })));
  });

  router.get('/admin/tickets/:id', adminAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Обращение не найдено' });
    const order = t.order_id
      ? db.prepare('SELECT id, nick, product_name, qty, amount_kop, status FROM orders WHERE id = ?').get(t.order_id)
      : null;
    res.json({ ...publicTicket(db, t), email: t.email, order: order ? { ...order, amount: order.amount_kop / 100 } : null });
  });

  router.post('/admin/tickets/:id/reply', adminAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Обращение не найдено' });
    const message = clean(req.body?.message, 4000);
    if (!message) return res.status(400).json({ error: 'Напишите ответ' });
    const status = req.body?.close ? 'closed' : 'answered';
    const ts = now();
    tx(db, () => {
      db.prepare('INSERT INTO ticket_messages(ticket_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(t.id, 'admin', message, ts);
      db.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, ts, t.id);
    });
    res.json({ ok: true, status });
  });

  router.post('/admin/tickets/:id/status', adminAuth, (req, res) => {
    const status = String(req.body?.status ?? '');
    if (!['open', 'answered', 'closed'].includes(status)) return res.status(400).json({ error: 'Неверный статус' });
    const r = db.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), req.params.id);
    if (!Number(r.changes)) return res.status(404).json({ error: 'Обращение не найдено' });
    res.json({ ok: true });
  });

  router.delete('/admin/tickets/:id', adminAuth, (req, res) => {
    db.prepare('DELETE FROM ticket_messages WHERE ticket_id = ?').run(req.params.id);
    db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
}
