import crypto from 'node:crypto';

export const now = () => Date.now();
export const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/** Простой ограничитель запросов в памяти: не более max за windowMs на ключ. */
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return false;
    }
    arr.push(t);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return true;
  };
}
