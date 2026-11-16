// Товар «Токены» в категории «Валюта»: 1 ₽ за 1000 токенов, покупка любого количества от 1000 токенов.
// В команде выдачи {qty} = число токенов. Добавляется один раз; удалённый товар не возвращается.
const DESC = [
  '1 ₽ = 1000 токенов. Минимальная покупка — от 1000 токенов.',
  '',
  'Игровая валюта, позволяющая открыть и бустануть себя, а также ускорить твоё выживание.',
  '',
  'Потратить их можно здесь:',
  '/tkits ⇨ Донат Наборы',
  '/tshop ⇨ Элитные вещи',
  '/case ⇨ Покупка кейсов',
  '/spawner ⇨ Покупка спавнеров',
  'и другое',
].join('\n');

import { DEFAULT_SETTINGS } from './db.js';
import { DEFAULT_RULES } from './rules-text.js';

/** Подставить правила сервера, если там ещё стоит заглушка по умолчанию (изменённый в админке текст не трогаем). */
export function seedRules(db) {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'rules' AND (value = ? OR value LIKE '4. Общие правила:%' OR (value LIKE '%5.9 Список программ:%' AND value NOT LIKE '%Ocean - %') OR value LIKE '%[смотрите здесь]%')").run(
    DEFAULT_RULES,
    DEFAULT_SETTINGS.rules,
  );
}

export function seedTokens(db, command) {
  // v2: количество = число токенов (любое от 1000), цена 1 ₽ за 1000 токенов (price_per = 1000).
  // Команда выдачи теперь без умножения: {qty} = число токенов.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'seed_tokens_v2'").get()) {
    db.prepare(
      `UPDATE products SET price_kop = 100, price_per = 1000, qty_min = 1000, qty_max = 10000000,
              allow_qty = 1, unit = '1000 токенов', description = ?, commands = ?
       WHERE name = 'Токены'`,
    ).run(DESC, JSON.stringify([command]));
    db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_tokens_v2', '1')").run();
  }

  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_tokens_v1'").get()) return;
  if (!db.prepare("SELECT 1 FROM products WHERE name = 'Токены'").get()) {
    db.prepare(
      `INSERT INTO products(name, description, category, image_url, price_kop, price_per, allow_qty, qty_min, qty_max, unit, commands, online_only, active, sort)
       VALUES ('Токены', ?, 'Валюта', '/img/tokens.png', 100, 1000, 1, 1000, 10000000, '1000 токенов', ?, 0, 1, 0)`,
    ).run(DESC, JSON.stringify([command]));
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_tokens_v1', '1')").run();
}

const UNBAN_DESC = [
  'Самый обыкновенный разбан.',
  '',
  'Не разбанит вас, если:',
  '1. Вы были много раз в бане',
  '2. Вы сильно вредите серверу',
  '3. Занимаетесь взломами',
  'и так далее..',
].join('\n');

/** Товар «Разбан» в разделе «Другое»: unban + unbanip на ник покупателя. Добавляется один раз. */
export function seedUnban(db) {
  db.prepare("UPDATE products SET image_url = '/img/unban.png' WHERE name = 'Разбан' AND (image_url IS NULL OR image_url = '')").run();
  // цена по умолчанию была 100 ₽ — привести к 149 ₽ (изменённую в админке не трогаем)
  db.prepare("UPDATE products SET price_kop = 14900 WHERE name = 'Разбан' AND price_kop = 10000").run();
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_unban_v1'").get()) return;
  if (!db.prepare("SELECT 1 FROM products WHERE name = 'Разбан'").get()) {
    db.prepare(
      `INSERT INTO products(name, description, category, image_url, price_kop, allow_qty, qty_min, qty_max, unit, commands, online_only, active, sort)
       VALUES ('Разбан', ?, 'Другое', '/img/unban.png', 14900, 0, 1, 1, '', ?, 0, 1, 10)`,
    ).run(UNBAN_DESC, JSON.stringify(['unban {player}', 'unbanip {player}']));
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_unban_v1', '1')").run();
}

const ELITE_DESC = [
  'Возможности привилегии:',
  '',
  '⚕ Префикс в чате и табе: [Элита] ВашНик',
  '› /kit Элита ⇨ Получить набор Элиты',
  '› /time ⇨ Установить время',
  '› /weather ⇨ Установить погоду',
  '› /loom ⇨ Открыть Ткацкий станок',
  '› /carttable ⇨ Открыть Стол картографа',
  '› /msgtoggle ⇨ Отключить Личные сообщения',
  '› /beezooka ⇨ Выстрелить пчелой',
  '› /kittycannon ⇨ Выстрелить котом',
  '› /firework ⇨ Настроить фейерверк',
  '› /name ⇨ Изменить название предмета цветным',
  '› /fly ⇨ Полёт на элитрах как в креативе',
].join('\n');

/** Привилегия «Элита» в разделе «Привилегии». Добавляется один раз. */
export function seedElite(db) {
  db.prepare("UPDATE products SET price_kop = 8900 WHERE name = 'Элита' AND price_kop = 29900").run();
  db.prepare("UPDATE products SET image_url = '/img/elite.png' WHERE name = 'Элита' AND (image_url IS NULL OR image_url = '')").run();
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_elite_v1'").get()) return;
  if (!db.prepare("SELECT 1 FROM products WHERE name = 'Элита'").get()) {
    db.prepare(
      `INSERT INTO products(name, description, category, image_url, price_kop, allow_qty, qty_min, qty_max, unit, commands, online_only, active, sort)
       VALUES ('Элита', ?, 'Привилегии', '/img/elite.png', 8900, 0, 1, 1, '', ?, 0, 1, 1)`,
    ).run(ELITE_DESC, JSON.stringify(['lp user {player} parent set elite']));
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_elite_v1', '1')").run();
}

const TITAN_DESC = [
  'Возможности привилегии:',
  '',
  '⚕ Префикс в чате и табе: [Титан] ВашНик',
  '› /kit Титан ⇨ Получить набор Титана',
  '› /jump ⇨ Телепортация на блок взгляда',
  "› /afk ⇨ Установить режим «АФК»",
  '› /setwarp ⇨ Установить точку варпа',
  '› /delwarp ⇨ Удалить точку варпа',
  '› /repair ⇨ Починить вещь в руке',
].join('\n');

/** Привилегия «Титан» в разделе «Привилегии». Добавляется один раз. */
export function seedTitan(db) {
  db.prepare("UPDATE products SET price_kop = 12900 WHERE name = 'Титан' AND price_kop = 49900").run();
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_titan_v1'").get()) return;
  if (!db.prepare("SELECT 1 FROM products WHERE name = 'Титан'").get()) {
    db.prepare(
      `INSERT INTO products(name, description, category, image_url, price_kop, allow_qty, qty_min, qty_max, unit, commands, online_only, active, sort)
       VALUES ('Титан', ?, 'Привилегии', '/img/titan.png', 12900, 0, 1, 1, '', ?, 0, 1, 2)`,
    ).run(TITAN_DESC, JSON.stringify(['lp user {player} parent set titan']));
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_titan_v1', '1')").run();
}

const PRINCE_DESC = [
  'Возможности привилегии:',
  '',
  '⚕ Префикс в чате и табе: [Принц] ВашНик',
  '› /kit Принц ⇨ Получить набор Принца',
  '› /smithtable ⇨ Открыть стол Кузнеца',
  '› /stonecutter ⇨ Открыть Камнерез',
  '› /grindstone ⇨ Открыть Точило',
].join('\n');

/** Привилегия «Принц» в разделе «Привилегии». Добавляется один раз. */
export function seedPrince(db) {
  db.prepare("UPDATE products SET price_kop = 24900 WHERE name = 'Принц' AND price_kop = 4900").run();
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_prince_v1'").get()) return;
  if (!db.prepare("SELECT 1 FROM products WHERE name = 'Принц'").get()) {
    db.prepare(
      `INSERT INTO products(name, description, category, image_url, price_kop, allow_qty, qty_min, qty_max, unit, commands, online_only, active, sort)
       VALUES ('Принц', ?, 'Привилегии', '/img/prince.png', 24900, 0, 1, 1, '', ?, 0, 1, 0)`,
    ).run(PRINCE_DESC, JSON.stringify(['lp user {player} parent set princ']));
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_prince_v1', '1')").run();
}

const KNYAZ_DESC = [
  'Возможности привилегии:',
  '',
  '⚕ Префикс в чате и табе: [Князь] ВашНик',
  '› /kit Князь ⇨ Получить набор Князя',
  '› /amute ⇨ Выдать МУТ игроку',
  '› /enchant ⇨ Зачаровать предмет в руке',
  '› /anvil ⇨ Открыть портативную Наковальню',
  '› /speed ⇨ Установить скорость передвижения',
  '› /salary ⇨ Получить зарплату',
  '› /exp ⇨ Получить бесплатный опыт',
].join('\n');

/** Привилегия «Князь» в разделе «Привилегии». Добавляется один раз. */
export function seedKnyaz(db) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_knyaz_v1'").get()) return;
  if (!db.prepare("SELECT 1 FROM products WHERE name = 'Князь'").get()) {
    db.prepare(
      `INSERT INTO products(name, description, category, image_url, price_kop, allow_qty, qty_min, qty_max, unit, commands, online_only, active, sort)
       VALUES ('Князь', ?, 'Привилегии', '/img/knyaz.png', 42900, 0, 1, 1, '', ?, 0, 1, 3)`,
    ).run(KNYAZ_DESC, JSON.stringify(['lp user {player} parent set knyaz']));
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_knyaz_v1', '1')").run();
}

const DUKE_DESC = [
  'Возможности привилегии:',
  '',
  '⚕ Префикс в чате и табе: [Герцог] ВашНик',
  '› /kit ⇨ Получить наборы Герцога',
  '› /enchant ⇨ Зачаровать предмет в руке',
  '› /anvil ⇨ Открыть портативную Наковальню',
  '› /speed ⇨ Установить скорость передвижения',
  '› /salary ⇨ Получить зарплату',
  '› /exp ⇨ Получить бесплатный опыт',
].join('\n');

/** Привилегия «Герцог» (навсегда) в разделе «Привилегии». Добавляется один раз. */
export function seedDuke(db) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_duke_v1'").get()) return;
  if (!db.prepare("SELECT 1 FROM products WHERE name = 'Герцог'").get()) {
    db.prepare(
      `INSERT INTO products(name, description, category, image_url, price_kop, allow_qty, qty_min, qty_max, unit, commands, online_only, active, sort)
       VALUES ('Герцог', ?, 'Привилегии', '/img/duke.png', 52900, 0, 1, 1, '', ?, 0, 1, 4)`,
    ).run(DUKE_DESC, JSON.stringify(['lp user {player} parent set gercog']));
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_duke_v1', '1')").run();
}

// Привилегии со сроком: группа LuckPerms, цены (₽) за 30 дней / 90 дней / навсегда.
const PRIVS = [
  { name: 'Элита', group: 'elite', p30: 36, p90: 62, forever: 89 },
  { name: 'Титан', group: 'titan', p30: 52, p90: 90, forever: 129 },
  { name: 'Принц', group: 'princ', p30: 100, p90: 174, forever: 249 },
  { name: 'Князь', group: 'knyaz', p30: 172, p90: 300, forever: 429 },
  { name: 'Герцог', group: 'gercog', p30: 212, p90: 370, forever: 529 },
];

/**
 * Каждая привилегия продаётся на 30 дней, 90 дней и навсегда. Это три отдельных товара с общим group_name;
 * на витрине они склеиваются в одну карточку с переключателем срока.
 * Навсегда: parent set <группа>; на срок: parent settemp <группа> <срок>.
 */
export function seedPrivilegePeriods(db) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_periods_v1'").get()) return;
  const ins = db.prepare(
    `INSERT INTO products(name, description, category, image_url, price_kop, allow_qty, qty_min, qty_max, unit, commands, online_only, active, sort, group_name, period)
     VALUES (?, ?, 'Привилегии', ?, ?, 0, 1, 1, '', ?, 0, 1, ?, ?, ?)`,
  );
  for (const v of PRIVS) {
    const base = db.prepare('SELECT * FROM products WHERE name = ?').get(v.name);
    if (!base) continue;
    db.prepare('UPDATE products SET name = ?, group_name = ?, period = ?, price_kop = ? WHERE id = ?')
      .run(`${v.name} — навсегда`, v.name, 'Навсегда', v.forever * 100, base.id);
    ins.run(`${v.name} — 30 дней`, base.description, base.image_url, v.p30 * 100,
      JSON.stringify([`lp user {player} parent settemp ${v.group} 30d`]), base.sort, v.name, '30 дней');
    ins.run(`${v.name} — 90 дней`, base.description, base.image_url, v.p90 * 100,
      JSON.stringify([`lp user {player} parent settemp ${v.group} 90d`]), base.sort, v.name, '90 дней');
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_periods_v1', '1')").run();
}

/** Товар «Размут» в разделе «Другое»: unmute на ник покупателя. Добавляется один раз. */
export function seedUnmute(db) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_unmute_v1'").get()) return;
  if (!db.prepare("SELECT 1 FROM products WHERE name = 'Размут'").get()) {
    db.prepare(
      `INSERT INTO products(name, description, category, image_url, price_kop, allow_qty, qty_min, qty_max, unit, commands, online_only, active, sort)
       VALUES ('Размут', 'Снятие мута с вашего аккаунта.', 'Другое', '/img/unmute.png', 4900, 0, 1, 1, '', ?, 0, 1, 11)`,
    ).run(JSON.stringify(['unmute {player}']));
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_unmute_v1', '1')").run();
}

/** Порядок на витрине: Элита → Титан → Принц → Князь → Герцог → Токены → Размут → Разбан. Применяется один раз. */
export function seedOrder(db) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seed_order_v1'").get()) return;
  const order = ['Элита', 'Титан', 'Принц', 'Князь', 'Герцог', 'Токены', 'Размут', 'Разбан'];
  const upd = db.prepare('UPDATE products SET sort = ? WHERE name = ? OR group_name = ?');
  order.forEach((n, i) => upd.run(i + 1, n, n));
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('seed_order_v1', '1')").run();
}
