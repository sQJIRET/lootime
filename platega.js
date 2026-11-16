// Клиент Platega. Эндпоинты и поля взяты из документации docs.platega.io
// и исходников неофициального SDK: POST /transaction/process, GET /transaction/{id}.

export class PlategaError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function createPlatega({ merchantId, secret, baseUrl = 'https://app.platega.io' }) {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = {
    'X-MerchantId': merchantId,
    'X-Secret': secret,
    'Content-Type': 'application/json',
  };

  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new PlategaError('Нет связи с Platega: ' + e.message, 0);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* не JSON */
    }
    if (!res.ok) {
      throw new PlategaError(`Platega вернула ${res.status}`, res.status, json ?? text);
    }
    return json;
  }

  return {
    enabled: Boolean(merchantId && secret),
    merchantId,
    secret,

    /** Создать платёж. Возвращает { transactionId, redirect }. */
    async createTransaction({ method, amountRub, description, returnUrl, failedUrl, orderId }) {
      const r = await call('POST', '/transaction/process', {
        paymentMethod: method,
        paymentDetails: { amount: amountRub, currency: 'RUB' },
        description,
        return: returnUrl,
        failedUrl,
        payload: orderId,
      });
      if (!r?.transactionId || !r?.redirect) {
        throw new PlategaError('Platega не вернула ссылку на оплату', 502, r);
      }
      return { transactionId: r.transactionId, redirect: r.redirect };
    },

    /** Проверить статус платежа напрямую у Platega. */
    async getTransaction(id) {
      return call('GET', `/transaction/${encodeURIComponent(id)}`);
    },
  };
}
