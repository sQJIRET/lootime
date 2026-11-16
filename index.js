import express from 'express';
import { createMarkPaid } from './delivery.js';
import { shopRoutes } from './shop.js';
import { plategaRoutes } from './platega-callback.js';
import { pluginRoutes } from './plugin.js';
import { adminRoutes } from './admin.js';
import { ticketRoutes } from './tickets.js';

/**
 * Единая точка входа для всех запросов /api/*.
 * Подключается в app.js: app.use('/api', createApiRouter(...)).
 * Адреса не изменились (/api/shop, /api/checkout, /api/platega/callback, /api/plugin/*, /api/admin/*).
 */
export function createApiRouter({ db, config, platega }) {
  const router = express.Router();
  const markPaid = createMarkPaid(db);
  const ctx = { db, config, platega, markPaid };

  router.use(express.json({ limit: '100kb' }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  shopRoutes(router, ctx);
  plategaRoutes(router, ctx);
  pluginRoutes(router, ctx);
  ticketRoutes(router, ctx);
  if (config.adminEnabled) adminRoutes(router, ctx);

  router.use((req, res) => res.status(404).json({ error: 'not_found' }));
  router.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка' });
  });

  return { router, markPaid };
}
