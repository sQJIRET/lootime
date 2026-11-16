import { tx } from '../db.js';
import { now, safeEqual } from './util.js';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 20;

/** API плагина Minecraft: очередь выдачи и подтверждения. */
export function pluginRoutes(router, { db, config }) {
  function pluginAuth(req, res, next) {
    const h = req.get('Authorization') ?? '';
    const key = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!config.pluginKey || !safeEqual(key, config.pluginKey)) return res.status(401).json({ error: 'unauthorized' });
    next();
  }

  router.get('/plugin/pending', pluginAuth, (req, res) => {
    const t = now();
    const rows = tx(db, () => {
      const list = db
        .prepare(
          `SELECT id, nick, command, online_only FROM deliveries
           WHERE (status = 'pending' OR (status = 'sent' AND lease_until < ?))
             AND next_try <= ? AND attempts < ?
           ORDER BY id ASC LIMIT 50`,
        )
        .all(t, t, MAX_ATTEMPTS);
      const lease = db.prepare(
        "UPDATE deliveries SET status = 'sent', lease_until = ?, attempts = attempts + 1 WHERE id = ?",
      );
      for (const r of list) lease.run(t + LEASE_MS, r.id);
      return list;
    });
    res.json({
      deliveries: rows.map((r) => ({
        id: r.id,
        player: r.nick,
        command: r.command,
        onlineOnly: Boolean(r.online_only),
      })),
    });
  });

  // result: done | failed | defer
  router.post('/plugin/ack', pluginAuth, (req, res) => {
    const results = Array.isArray(req.body?.results) ? req.body.results : [];
    const t = now();
    for (const r of results.slice(0, 200)) {
      const id = Number(r?.id);
      if (!Number.isInteger(id)) continue;
      if (r.result === 'done') {
        db.prepare("UPDATE deliveries SET status = 'done', done_at = ?, error = '' WHERE id = ?").run(t, id);
      } else if (r.result === 'defer') {
        // игрок не в сети: вернём в очередь, не считая попыткой
        db.prepare(
          "UPDATE deliveries SET status = 'pending', next_try = ?, attempts = MAX(attempts - 1, 0) WHERE id = ?",
        ).run(t + 30_000, id);
      } else {
        db.prepare("UPDATE deliveries SET status = 'pending', next_try = ?, error = ? WHERE id = ?").run(
          t + 60_000,
          String(r.error ?? 'ошибка').slice(0, 300),
          id,
        );
      }
    }
    res.json({ ok: true });
  });
}
