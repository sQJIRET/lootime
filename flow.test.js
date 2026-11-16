import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

// сообщение в чат при донате по умолчанию выключено: старые тесты считают команды выдачи
process.env.ANNOUNCE_ENABLED = '0';

const MERCHANT = 'merchant-123';
const SECRET = 'secret-abc';

function setup({ realAmount } = {}) {
  const db = openDb(':memory:');
  const calls = [];
  const fake = {
    enabled: true,
    merchantId: MERCHANT,
    secret: SECRET,
    async createTransaction(args) {
      calls.push(args);
      return { transactionId: 'tx-' + args.orderId, redirect: 'https://pay.example/' + args.orderId };
    },
    async getTransaction(id) {
      const orderId = id.replace('tx-', '');
      const o = db.prepare('SELECT amount_kop FROM orders WHERE id = ?').get(orderId);
      return { id, status: 'CONFIRMED', paymentDetails: { amount: realAmount ?? o.amount_kop / 100, currency: 'RUB' } };
    },
  };
  const config = {
    publicUrl: 'https://shop.test',
    adminEnabled: true,
    adminPassword: 'adminpass',
    sessionSecret: 'x'.repeat(32),
    pluginKey: 'plugin-key-0123456789',
    paymentMethods: [2, 10],
    devMode: false,
    trustProxy: false,
  };
  const { app } = createApp({ db, config, platega: fake });
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      srv.unref();
      const base = `http://127.0.0.1:${srv.address().port}`;
      resolve({ db, base, calls, close: () => { srv.closeAllConnections?.(); srv.close(); } });
    });
  });
}

const J = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const post = (url, body, headers = {}) => {
  const o = J(body);
  o.headers = { ...o.headers, ...headers };
  return fetch(url, o);
};

async function adminCookie(base) {
  const r = await post(base + '/api/admin/login', { password: 'adminpass' });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}

async function createProduct(base, cookie, extra = {}) {
  const r = await post(
    base + '/api/admin/products',
    { name: 'VIP', price: 199, category: 'Привилегии', commands: 'lp user {player} parent add vip\nsay {player} купил VIP', ...extra },
    { Cookie: cookie },
  );
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()).id;
}

test('админка закрыта без входа, неверный пароль отклоняется', async () => {
  const s = await setup();
  assert.equal((await fetch(s.base + '/api/admin/products')).status, 401);
  assert.equal((await post(s.base + '/api/admin/login', { password: 'nope' })).status, 401);
  s.close();
});

test('полный цикл: товар → заказ → callback → выдача плагином', async () => {
  const s = await setup();
  const cookie = await adminCookie(s.base);
  const pid = await createProduct(s.base, cookie);

  // витрина не показывает команды
  const shop = await (await fetch(s.base + '/api/shop')).json();
  assert.equal(shop.products.length, 1);
  assert.equal(shop.products[0].commands, undefined);

  // заказ
  const co = await post(s.base + '/api/checkout', { productId: pid, nick: 'Steve', email: 'test@example.com', consentPd: true, consentTerms: true, method: 2 });
  assert.equal(co.status, 200);
  const { orderId, redirect } = await co.json();
  assert.match(redirect, /^https:\/\/pay\.example\//);
  assert.equal(s.calls[0].amountRub, 199);
  assert.equal(s.calls[0].method, 2);

  // до оплаты выдавать нечего
  const key = { Authorization: 'Bearer plugin-key-0123456789' };
  let pend = await (await fetch(s.base + '/api/plugin/pending', { headers: key })).json();
  assert.equal(pend.deliveries.length, 0);

  // callback без заголовков / с чужим секретом отклоняется
  const cbBody = { id: 'tx-' + orderId, amount: 199, currency: 'RUB', status: 'CONFIRMED', paymentMethod: 2, payload: orderId };
  assert.equal((await post(s.base + '/api/platega/callback', cbBody)).status, 401);
  assert.equal(
    (await post(s.base + '/api/platega/callback', cbBody, { 'X-MerchantId': MERCHANT, 'X-Secret': 'wrong' })).status,
    401,
  );

  // верный callback
  const auth = { 'X-MerchantId': MERCHANT, 'X-Secret': SECRET };
  assert.equal((await post(s.base + '/api/platega/callback', cbBody, auth)).status, 200);
  // повтор не создаёт дубликатов
  assert.equal((await post(s.base + '/api/platega/callback', cbBody, auth)).status, 200);

  pend = await (await fetch(s.base + '/api/plugin/pending', { headers: key })).json();
  assert.equal(pend.deliveries.length, 2);
  assert.equal(pend.deliveries[0].player, 'Steve');
  assert.equal(pend.deliveries[0].command, 'lp user Steve parent add vip');
  assert.equal(pend.deliveries[1].command, 'say Steve купил VIP');

  // пока идёт «аренда», повторно не отдаём
  const again = await (await fetch(s.base + '/api/plugin/pending', { headers: key })).json();
  assert.equal(again.deliveries.length, 0);

  // подтверждение
  const ack = await post(
    s.base + '/api/plugin/ack',
    { results: pend.deliveries.map((d) => ({ id: d.id, result: 'done' })) },
    key,
  );
  assert.equal(ack.status, 200);

  const st = await (await fetch(s.base + '/api/order/' + orderId)).json();
  assert.equal(st.status, 'paid');
  assert.equal(st.delivered, true);
});

test('плагин без верного ключа не получает заказы', async () => {
  const s = await setup();
  assert.equal((await fetch(s.base + '/api/plugin/pending')).status, 401);
  assert.equal((await fetch(s.base + '/api/plugin/pending', { headers: { Authorization: 'Bearer bad' } })).status, 401);
  s.close();
});

test('количество: цена умножается, границы проверяются', async () => {
  const s = await setup();
  const cookie = await adminCookie(s.base);
  const pid = await createProduct(s.base, cookie, { name: 'Монеты', price: 10, allow_qty: true, qty_min: 5, qty_max: 50, commands: 'eco give {player} {qty}' });
  assert.equal((await post(s.base + '/api/checkout', { productId: pid, nick: 'Alex_1', email: 'test@example.com', consentPd: true, consentTerms: true, qty: 2, method: 2 })).status, 400);
  assert.equal((await post(s.base + '/api/checkout', { productId: pid, nick: 'Alex_1', email: 'test@example.com', consentPd: true, consentTerms: true, qty: 51, method: 2 })).status, 400);
  const ok = await post(s.base + '/api/checkout', { productId: pid, nick: 'Alex_1', email: 'test@example.com', consentPd: true, consentTerms: true, qty: 20, method: 10 });
  assert.equal(ok.status, 200);
  assert.equal(s.calls.at(-1).amountRub, 200);
  s.close();
});

test('плохой ник и недоступный способ оплаты отклоняются', async () => {
  const s = await setup();
  const cookie = await adminCookie(s.base);
  const pid = await createProduct(s.base, cookie);
  assert.equal((await post(s.base + '/api/checkout', { productId: pid, nick: 'a;rm -rf', email: 'test@example.com', consentPd: true, consentTerms: true, method: 2 })).status, 400);
  assert.equal((await post(s.base + '/api/checkout', { productId: pid, nick: 'Steve', email: 'test@example.com', consentPd: true, consentTerms: true, method: 99 })).status, 400);
  s.close();
});

test('недоплата уходит на проверку и не выдаёт товар', async () => {
  const s = await setup({ realAmount: 1 });
  const cookie = await adminCookie(s.base);
  const pid = await createProduct(s.base, cookie);
  const { orderId } = await (await post(s.base + '/api/checkout', { productId: pid, nick: 'Steve', email: 'test@example.com', consentPd: true, consentTerms: true, method: 2 })).json();
  const auth = { 'X-MerchantId': MERCHANT, 'X-Secret': SECRET };
  await post(s.base + '/api/platega/callback', { id: 'tx-' + orderId, amount: 1, currency: 'RUB', status: 'CONFIRMED', payload: orderId }, auth);
  const st = await (await fetch(s.base + '/api/order/' + orderId)).json();
  assert.equal(st.status, 'review');
  const key = { Authorization: 'Bearer plugin-key-0123456789' };
  assert.equal((await (await fetch(s.base + '/api/plugin/pending', { headers: key })).json()).deliveries.length, 0);

  // админ может выдать вручную
  const g = await post(s.base + `/api/admin/orders/${orderId}/grant`, {}, { Cookie: cookie });
  assert.equal(g.status, 200);
  assert.equal((await (await fetch(s.base + '/api/plugin/pending', { headers: key })).json()).deliveries.length, 2);
  s.close();
});

test('defer возвращает команду в очередь с задержкой', async () => {
  const s = await setup();
  const cookie = await adminCookie(s.base);
  const pid = await createProduct(s.base, cookie, { online_only: true, commands: 'give {player} diamond 1' });
  const { orderId } = await (await post(s.base + '/api/checkout', { productId: pid, nick: 'Steve', email: 'test@example.com', consentPd: true, consentTerms: true, method: 2 })).json();
  await s.db.prepare("UPDATE orders SET status='pending' WHERE id=?").run(orderId);
  await post(s.base + `/api/admin/orders/${orderId}/grant`, {}, { Cookie: cookie });
  const key = { Authorization: 'Bearer plugin-key-0123456789' };
  const first = await (await fetch(s.base + '/api/plugin/pending', { headers: key })).json();
  assert.equal(first.deliveries[0].onlineOnly, true);
  await post(s.base + '/api/plugin/ack', { results: [{ id: first.deliveries[0].id, result: 'defer' }] }, key);
  const row = s.db.prepare('SELECT status, next_try, attempts FROM deliveries WHERE id = ?').get(first.deliveries[0].id);
  assert.equal(row.status, 'pending');
  assert.ok(row.next_try > Date.now());
  assert.equal(row.attempts, 0);
  s.close();
});

test('без согласий или email оплата не создаётся', async () => {
  const s = await setup();
  const cookie = await adminCookie(s.base);
  const pid = await createProduct(s.base, cookie);
  const base = { productId: pid, nick: 'Steve', method: 2 };
  const url = s.base + '/api/checkout';
  assert.equal((await post(url, { ...base, email: 't@example.com', consentTerms: true })).status, 400);
  assert.equal((await post(url, { ...base, email: 't@example.com', consentPd: true })).status, 400);
  assert.equal((await post(url, { ...base, consentPd: true, consentTerms: true })).status, 400);
  assert.equal(s.calls.length, 0);
  assert.equal((await post(url, { ...base, email: 't@example.com', consentPd: true, consentTerms: true })).status, 200);
  assert.ok(s.db.prepare('SELECT consent_at FROM orders').get().consent_at > 0);
  s.close();
});

test('токены: любое количество от 1000, 1 ₽ = 1000 токенов', async () => {
  const s = await setup();
  const cookie = await adminCookie(s.base);
  const pid = await createProduct(s.base, cookie, { name: 'Токены2', price: 1, price_per: 1000, allow_qty: true, qty_min: 1000, qty_max: 10000000, commands: 'points give {player} {qty}' });
  const buy = (qty) => post(s.base + '/api/checkout', { productId: pid, nick: 'Alex_1', email: 'test@example.com', consentPd: true, consentTerms: true, qty, method: 2 });
  assert.equal((await buy(999)).status, 400);
  assert.equal((await buy(1000)).status, 200);
  assert.equal(s.calls.at(-1).amountRub, 1);
  assert.equal((await buy(25000)).status, 200);
  assert.equal(s.calls.at(-1).amountRub, 25);
  assert.equal((await buy(1500)).status, 200);
  assert.equal(s.calls.at(-1).amountRub, 1.5);
  s.close();
});

test('сообщение в чат о донате: tellraw ставится в очередь после команд товара', async () => {
  process.env.ANNOUNCE_ENABLED = '1';
  try {
    const s = await setup();
    const cookie = await adminCookie(s.base);
    const pid = await createProduct(s.base, cookie);
    const co = await post(s.base + '/api/checkout', { productId: pid, nick: 'Steve', email: 'test@example.com', consentPd: true, consentTerms: true, method: 2 });
    const { orderId } = await co.json();
    // подтверждаем заказ через админку (то же, что и оплата: создаются команды выдачи)
    assert.equal((await post(s.base + `/api/admin/orders/${orderId}/grant`, {}, { Cookie: cookie })).status, 200);
    const key = { Authorization: 'Bearer plugin-key-0123456789' };
    const pend = await (await fetch(s.base + '/api/plugin/pending', { headers: key })).json();
    assert.equal(pend.deliveries.length, 3);
    assert.match(pend.deliveries[2].command, /^tellraw @a \[/);
    assert.ok(pend.deliveries[2].command.includes('Steve'));
    assert.ok(pend.deliveries[2].command.includes('VIP'));
    s.close();
  } finally {
    process.env.ANNOUNCE_ENABLED = '0';
  }
});

test('тикеты: создание, доступ только по токену, ответ админа, закрытие', async () => {
  const s = await setup();
  const cookie = await adminCookie(s.base);
  const ok = { nick: 'Alex_1', email: 'a@b.co', subject: 'Не пришли токены', message: 'Купил токены, ничего не пришло', category: 'delivery', consentPd: true };
  assert.equal((await post(s.base + '/api/tickets', { ...ok, consentPd: false })).status, 400);
  assert.equal((await post(s.base + '/api/tickets', { ...ok, nick: 'x' })).status, 400);
  const created = await (await post(s.base + '/api/tickets', ok)).json();
  assert.match(created.id, /^T-[A-Z0-9]{6}$/);

  // без токена и с чужим токеном обращение не открыть
  assert.equal((await fetch(s.base + '/api/tickets/' + created.id)).status, 404);
  assert.equal((await fetch(s.base + '/api/tickets/' + created.id, { headers: { 'X-Ticket-Token': 'a'.repeat(32) } })).status, 404);
  const mine = { 'X-Ticket-Token': created.token };
  const t1 = await (await fetch(s.base + '/api/tickets/' + created.id, { headers: mine })).json();
  assert.equal(t1.messages.length, 1);
  assert.equal(t1.email, undefined);

  // админка: список закрыт без входа, ответ меняет статус
  assert.equal((await fetch(s.base + '/api/admin/tickets')).status, 401);
  const list = await (await fetch(s.base + '/api/admin/tickets', { headers: { Cookie: cookie } })).json();
  assert.equal(list.length, 1);
  assert.equal((await post(s.base + `/api/admin/tickets/${created.id}/reply`, { message: 'Проверяем' }, { Cookie: cookie })).status, 200);
  const t2 = await (await fetch(s.base + '/api/tickets/' + created.id, { headers: mine })).json();
  assert.equal(t2.status, 'answered');
  assert.deepEqual(t2.messages.map((m) => m.author), ['user', 'admin']);

  // ответ игрока снова открывает, закрытие запрещает писать
  assert.equal((await post(s.base + `/api/tickets/${created.id}/reply`, { message: 'Спасибо, жду' }, mine)).status, 200);
  assert.equal((await post(s.base + `/api/tickets/${created.id}/close`, {}, mine)).status, 200);
  assert.equal((await post(s.base + `/api/tickets/${created.id}/reply`, { message: 'ещё вопрос' }, mine)).status, 400);
  s.close();
});
