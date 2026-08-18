'use strict';

const hits = new Map();

function prune(now, windowMs) {
  for (const [key, stamps] of hits) {
    const next = stamps.filter((t) => now - t < windowMs);
    if (next.length) hits.set(key, next);
    else hits.delete(key);
  }
}

function supportPublicRateLimit({ windowMs = 10 * 60 * 1000, max = 20 } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 2000) prune(now, windowMs);
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const stamps = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (stamps.length >= max) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Please try again later.' });
    }
    stamps.push(now);
    hits.set(key, stamps);
    next();
  };
}

function _resetRateLimitForTests() {
  hits.clear();
}

module.exports = { supportPublicRateLimit, _resetRateLimitForTests };
