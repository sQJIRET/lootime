import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlatega } from './platega.js';
import { createApiRouter } from './api/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, config, platega: injectedPlatega }) {
  const app = express();
  const platega =
    injectedPlatega ??
    createPlatega({ merchantId: config.plategaMerchantId, secret: config.plategaSecret, baseUrl: config.plategaBase });

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // все /api/* идут через папку src/api
  const { router: api, markPaid } = createApiRouter({ db, config, platega });
  app.use('/api', api);

  if (config.devMode) {
    app.get('/dev/pay/:id', (req, res) => {
      const r = markPaid(req.params.id);
      if (!r.ok) return res.status(404).send('Заказ не найден');
      res.redirect(`/?order=${encodeURIComponent(req.params.id)}`);
    });
  }

  const pub = path.join(__dirname, '..', 'public');
  if (config.adminEnabled) {
    app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
  } else {
    app.use(['/admin', '/admin.html'], (req, res) => res.status(404).send('Not found'));
  }
  app.get('/rules', (req, res) => res.sendFile(path.join(pub, 'rules.html')));
  app.get('/contacts', (req, res) => res.sendFile(path.join(pub, 'contacts.html')));
  app.get(['/support', '/support.html'], (req, res) => res.redirect(301, '/contacts'));
  app.use(express.static(pub, { index: 'index.html', maxAge: 0 }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка' });
  });

  return { app, markPaid };
}
