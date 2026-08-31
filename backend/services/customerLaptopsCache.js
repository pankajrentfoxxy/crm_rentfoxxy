/**
 * Redis / in-memory cache-aside for customer laptop list + counts.
 */
const { cacheGet, cacheSet, cacheDelPattern, CACHE_TTL } = require('../utils/cacheService');

const CACHE_VERSION = 'v1';
const LIST_TTL_SEC = parseInt(
  process.env.CACHE_TTL_CUSTOMER_LAPTOPS_SEC || String(CACHE_TTL.CUSTOMER_LAPTOPS || 45),
  10
);

function cacheDisabled() {
  return process.env.CUSTOMER_LAPTOPS_CACHE === '0' || process.env.CUSTOMER_LAPTOPS_CACHE === 'false';
}

function sanitizePart(value) {
  if (value == null || value === '') return '-';
  return encodeURIComponent(String(value)).slice(0, 160);
}

function buildCustomerLaptopsCacheKey({
  customerId,
  lifecycle,
  page,
  limit,
  search,
  from,
  to,
  statuses,
  paginate,
}) {
  return [
    'customer_laptops',
    CACHE_VERSION,
    customerId,
    paginate ? 'p' : 'all',
    sanitizePart(lifecycle || 'active'),
    page || 0,
    limit || 0,
    sanitizePart(search),
    sanitizePart(from),
    sanitizePart(to),
    sanitizePart(statuses),
  ].join(':');
}

async function getCachedCustomerLaptops(key) {
  if (cacheDisabled() || !key) return undefined;
  return cacheGet(key);
}

async function setCachedCustomerLaptops(key, payload) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, payload, LIST_TTL_SEC);
}

function invalidateCustomerLaptopsCache(customerId) {
  const prefix = customerId
    ? `customer_laptops:${CACHE_VERSION}:${customerId}:`
    : `customer_laptops:${CACHE_VERSION}:`;
  cacheDelPattern(prefix).catch((err) => {
    console.warn('[cache] customer laptops invalidate failed:', err.message);
  });
}

module.exports = {
  LIST_TTL_SEC,
  buildCustomerLaptopsCacheKey,
  getCachedCustomerLaptops,
  setCachedCustomerLaptops,
  invalidateCustomerLaptopsCache,
};
