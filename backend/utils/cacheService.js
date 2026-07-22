const DEFAULT_TTL_SEC = 300;

/** @type {Map<string, { value: unknown, expiresAt: number }>} */
const memory = new Map();

let redis = null;
let redisReady = false;

async function initCache() {
  const url = process.env.REDIS_URL;
  if (!url) return;

  try {
    const { createClient } = require('redis');
    redis = createClient({ url });
    redis.on('error', (err) => {
      console.warn('[cache] Redis error:', err.message);
    });
    await redis.connect();
    redisReady = true;
    console.log('[cache] Redis connected');
  } catch (err) {
    console.warn('[cache] Redis unavailable, using in-memory cache:', err.message);
    redis = null;
    redisReady = false;
  }
}

function memoryGet(key) {
  const entry = memory.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memory.delete(key);
    return undefined;
  }
  return entry.value;
}

function memorySet(key, value, ttlSec) {
  memory.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

async function cacheGet(key) {
  if (redisReady) {
    try {
      const raw = await redis.get(key);
      if (raw != null) return JSON.parse(raw);
    } catch {
      /* fall through to memory */
    }
  }
  return memoryGet(key);
}

async function cacheSet(key, value, ttlSec = DEFAULT_TTL_SEC) {
  memorySet(key, value, ttlSec);
  if (redisReady) {
    try {
      await redis.setEx(key, ttlSec, JSON.stringify(value));
    } catch {
      /* memory cache still holds the value */
    }
  }
}

async function cacheWrap(key, ttlSec, fn) {
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;
  const value = await fn();
  await cacheSet(key, value, ttlSec);
  return value;
}

async function cacheDelPattern(prefix) {
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  if (redisReady) {
    try {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length) await redis.del(keys);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  initCache,
  cacheGet,
  cacheSet,
  cacheWrap,
  cacheDelPattern,
  CACHE_TTL: {
    FILTER_OPTIONS: parseInt(process.env.CACHE_TTL_FILTER_OPTIONS_SEC || '300', 10),
    OBSERVED_SPECS: parseInt(process.env.CACHE_TTL_OBSERVED_SPECS_SEC || '600', 10),
    CASCADE_BRAND: parseInt(process.env.CACHE_TTL_CASCADE_BRAND_SEC || '300', 10),
    MASTER_LOOKUP: parseInt(process.env.CACHE_TTL_MASTER_LOOKUP_SEC || '86400', 10),
    INVENTORY_LIST: parseInt(process.env.CACHE_TTL_INVENTORY_LIST_SEC || '300', 10),
    INVENTORY_COUNT: parseInt(process.env.CACHE_TTL_INVENTORY_COUNT_SEC || '600', 10),
  },
};
