import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedTokens, seedRules, seedUnban, seedElite, seedTitan, seedPrince, seedKnyaz, seedDuke, seedPrivilegePeriods, seedUnmute, seedOrder } from './seed.js';

const env = process.env;

const config = {
  port: Number(String(env.PORT ?? 3000).split(',')[0]),
  ports: String(env.PORT ?? 3000).split(',').map((x) => Number(x.trim())).filter(Boolean),
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, ''),
  adminEnabled: env.ADMIN_ENABLED === '1',
  adminPassword: env.ADMIN_PASSWORD ?? '',
  sessionSecret: env.SESSION_SECRET ?? '',
  pluginKey: env.PLUGIN_KEY ?? '',
  plategaMerchantId: env.PLATEGA_MERCHANT_ID ?? '',
  plategaSecret: env.PLATEGA_SECRET ?? '',
  plategaBase: env.PLATEGA_BASE ?? 'https://app.platega.io',
  paymentMethods: (env.PAYMENT_METHODS ?? '2,10,13')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter(Number.isInteger),
  // промокоды: PROMO_CODES=LOON10:10,VIP5:5  (код:скидка в процентах)
  promos: Object.fromEntries(
    (env.PROMO_CODES ?? '')
      .split(',')
      .map((x) => x.trim().split(':'))
      .filter(([c, p]) => c && Number(p) > 0 && Number(p) <= 90)
      .map(([c, p]) => [c.toUpperCase(), Number(p)]),
  ),
  // встроенный HTTPS (Let's Encrypt). Включается, если задан HTTPS_DOMAIN
  httpsDomain: (env.HTTPS_DOMAIN ?? '').trim().toLowerCase(),
  httpPort: Number(env.HTTP_PORT ?? 80),
  httpsPort: Number(env.HTTPS_PORT ?? 443),
  acmeEmail: env.ACME_EMAIL ?? '',
  acmeStaging: env.ACME_STAGING === '1',
  certDir: env.CERT_DIR ?? './data/certs',
  dbPath: env.DB_PATH ?? './data/shop.db',
  trustProxy: env.TRUST_PROXY === '1',
  devMode: env.DEV_MODE === '1',
  duckdnsToken: (env.DUCKDNS_TOKEN ?? '').trim(),
  duckdnsDomain: (env.DUCKDNS_DOMAIN ?? 'loontime.duckdns.org').trim().toLowerCase(),
};

const problems = [];
if (config.adminEnabled && (!config.adminPassword || config.adminPassword === 'поменяйте-меня')) problems.push('ADMIN_PASSWORD не задан (или поставьте ADMIN_ENABLED=0)');
if (config.sessionSecret.length < 16) problems.push('SESSION_SECRET должен быть не короче 16 символов');
if (config.pluginKey.length < 16) problems.push('PLUGIN_KEY должен быть не короче 16 символов');
if (!config.devMode && (!config.plategaMerchantId || !config.plategaSecret)) {
  console.warn('⚠ PLATEGA_MERCHANT_ID / PLATEGA_SECRET не заданы: сайт открывается, но оплата недоступна.');
}
if (problems.length) {
  console.error('Ошибка настройки (.env):\n - ' + problems.join('\n - '));
  process.exit(1);
}
if (config.devMode) console.warn('⚠ DEV_MODE включён: оплата имитируется, в бою так оставлять нельзя!');

const db = openDb(config.dbPath);
// команда выдачи токенов; {player} — ник, {qty} — число токенов
seedRules(db);
seedUnban(db);
seedElite(db);
seedTitan(db);
seedPrince(db);
seedKnyaz(db);
seedDuke(db);
seedPrivilegePeriods(db);
seedUnmute(db);
seedOrder(db);
seedTokens(db, env.TOKENS_COMMAND ?? 'points give {player} {qty}');
const { app } = createApp({ db, config });

app.listen(config.port, () => {
  console.log(`Сайт запущен: ${config.publicUrl} (порт ${config.port}, только http)`);
  console.log(`Callback для Platega: ${config.publicUrl}/api/platega/callback`);
});
