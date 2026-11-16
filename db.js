import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Прочее',
      image_url TEXT NOT NULL DEFAULT '',
      price_kop INTEGER NOT NULL,
      allow_qty INTEGER NOT NULL DEFAULT 0,
      qty_min INTEGER NOT NULL DEFAULT 1,
      qty_max INTEGER NOT NULL DEFAULT 1,
      commands TEXT NOT NULL DEFAULT '[]',
      online_only INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      nick TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      amount_kop INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      method INTEGER,
      transaction_id TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      paid_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS orders_nick ON orders(nick);

    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      nick TEXT NOT NULL,
      command TEXT NOT NULL,
      online_only INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      lease_until INTEGER NOT NULL DEFAULT 0,
      next_try INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      done_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS deliveries_status ON deliveries(status);

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      nick TEXT NOT NULL,
      email TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      subject TEXT NOT NULL,
      order_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status, updated_at);

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages(ticket_id, id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // миграция: корзина (несколько товаров), email, промокод
  const cols = new Set(db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name));
  const pcols = new Set(db.prepare('PRAGMA table_info(products)').all().map((c) => c.name));
  if (!pcols.has('unit')) db.exec("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT ''");
  if (!pcols.has('price_per')) db.exec('ALTER TABLE products ADD COLUMN price_per INTEGER NOT NULL DEFAULT 1');
  if (!pcols.has('group_name')) db.exec("ALTER TABLE products ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
  if (!pcols.has('period')) db.exec("ALTER TABLE products ADD COLUMN period TEXT NOT NULL DEFAULT ''");
  if (!cols.has('items')) db.exec("ALTER TABLE orders ADD COLUMN items TEXT NOT NULL DEFAULT ''");
  if (!cols.has('email')) db.exec("ALTER TABLE orders ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  if (!cols.has('promo')) db.exec("ALTER TABLE orders ADD COLUMN promo TEXT NOT NULL DEFAULT ''");
  if (!cols.has('consent_at')) db.exec('ALTER TABLE orders ADD COLUMN consent_at INTEGER');
  if (!cols.has('discount_kop')) db.exec('ALTER TABLE orders ADD COLUMN discount_kop INTEGER NOT NULL DEFAULT 0');

  seedSettings(db);
  return db;
}

export const DEFAULT_SETTINGS = {
  shop_name: 'Loontime',
  tagline: 'Поддержи сервер и получи крутые привилегии',
  server_ip: '',
  telegram: '',
  discord: '',
  youtube: '',
  tiktok: '',
  rules: 'Здесь будут правила сервера. Измените текст в админке → Настройки.',
  refund_info:
    'Товар выдаётся автоматически в течение минуты после оплаты. Если что-то пошло не так, напишите нам в Discord или Telegram и укажите ник и номер заказа.',
};

function seedSettings(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
}

export function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

export function setSettings(db, patch) {
  const up = db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_SETTINGS) up.run(k, String(v ?? '').slice(0, 5000));
  }
}

/** Выполнить функцию в транзакции SQLite. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
