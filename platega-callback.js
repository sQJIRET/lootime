import { safeEqual } from './util.js';

/** Callback Platega: подтверждение оплаты. */
export function plategaRoutes(router, { db, platega, markPaid }) {
  router.post('/platega/callback', async (req, res) => {
    const okAuth =
      platega.enabled &&
      safeEqual(req.get('X-MerchantId'), platega.merchantId) &&
      safeEqual(req.get('X-Secret'), platega.secret);
    if (!okAuth) return res.status(401).json({ error: 'unauthorized' });

    const body = req.body ?? {};
    const orderId = String(body.payload ?? '');
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(200).json({ status: 'ignored' }); // чужой/неизвестный платёж, ретраи не нужны

    if (body.status === 'CANCELED') {
      db.prepare("UPDATE orders SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(orderId);
      return res.status(200).json({ status: 'ok' });
    }
    if (body.status !== 'CONFIRMED') return res.status(200).json({ status: 'ignored' });

    if (order.transaction_id && body.id && order.transaction_id !== body.id) {
      console.warn('[callback] id транзакции не совпал с заказом', orderId);
      return res.status(200).json({ status: 'ignored' });
    }

    // Не верим одному только callback: перепроверяем статус и сумму напрямую у Platega.
    try {
      const real = await platega.getTransaction(body.id);
      if (real?.status !== 'CONFIRMED') {
        console.warn('[callback] Platega не подтвердила статус', orderId, real?.status);
        return res.status(200).json({ status: 'ignored' });
      }
      const paid = Number(real?.paymentDetails?.amount);
      if (Number.isFinite(paid) && Math.round(paid * 100) < order.amount_kop) {
        console.warn('[callback] Сумма меньше ожидаемой', orderId, paid, order.amount_kop / 100);
        db.prepare("UPDATE orders SET status = 'review', note = ? WHERE id = ?").run(
          `Оплачено ${paid} вместо ${order.amount_kop / 100}`,
          orderId,
        );
        return res.status(200).json({ status: 'review' });
      }
    } catch (e) {
      console.error('[callback] не удалось проверить платёж:', e.message);
      return res.status(503).json({ error: 'verify_failed' }); // Platega повторит позже
    }

    const r = markPaid(orderId, { transactionId: body.id });
    res.status(r.ok ? 200 : 500).json({ status: r.ok ? 'ok' : r.reason });
  });
}
