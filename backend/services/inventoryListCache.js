/**
 * Redis / in-memory cache-aside for inventory list + count endpoints.
 */
const { cacheGet, cacheSet, cacheDelPattern } = require('../utils/cacheService');

const CACHE_VERSION = 'v2';
const LIST_TTL_SEC = parseInt(process.env.CACHE_TTL_INVENTORY_LIST_SEC || '300', 10);
const COUNT_TTL_SEC = parseInt(process.env.CACHE_TTL_INVENTORY_COUNT_SEC || '600', 10);

function cacheDisabled() {
  return process.env.INVENTORY_LIST_CACHE === '0' || process.env.INVENTORY_LIST_CACHE === 'false';
}

function sanitizePart(value) {
  if (value == null || value === '') return '-';
  return encodeURIComponent(String(value)).slice(0, 120);
}

function stableFilterKey(specFilters = {}) {
  const parts = Object.keys(specFilters)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(specFilters[k])}`);
  return parts.length ? parts.join('&') : '-';
}

function buildListCacheKey({ segment, page, limit, search, dateFrom, dateTo, specFilters, cursor, ticketStageFilter, inventoryTagAccess = 'all' }) {
  const filters = stableFilterKey(specFilters);
  const searchPart = sanitizePart(search);
  const from = sanitizePart(dateFrom);
  const to = sanitizePart(dateTo);
  const stagePart = sanitizePart(ticketStageFilter || 'all');
  const tagAccessPart = sanitizePart(inventoryTagAccess || 'all');
  if (cursor) {
    return `inventory:${CACHE_VERSION}:${segment}:cursor:${sanitizePart(cursor)}:${limit}:${searchPart}:${filters}:${from}:${to}:${stagePart}:${tagAccessPart}`;
  }
  return `inventory:${CACHE_VERSION}:${segment}:${page}:${limit}:${searchPart}:${filters}:${from}:${to}:${stagePart}:${tagAccessPart}`;
}

function buildCountCacheKey({ segment, search, dateFrom, dateTo, specFilters, ticketStageFilter, inventoryTagAccess = 'all' }) {
  const filters = stableFilterKey(specFilters);
  return `inventory_count:${CACHE_VERSION}:${segment}:${sanitizePart(search)}:${filters}:${sanitizePart(dateFrom)}:${sanitizePart(dateTo)}:${sanitizePart(ticketStageFilter || 'all')}:${sanitizePart(inventoryTagAccess || 'all')}`;
}

async function getCachedList(key) {
  if (cacheDisabled() || !key) return undefined;
  return cacheGet(key);
}

async function setCachedList(key, payload) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, payload, LIST_TTL_SEC);
}

async function getCachedCount(key) {
  if (cacheDisabled() || !key) return undefined;
  const v = await cacheGet(key);
  return v === undefined ? undefined : Number(v);
}

async function setCachedCount(key, total) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, total, COUNT_TTL_SEC);
}

function invalidateInventoryListCachesFireAndForget() {
  invalidateInventoryListCaches().catch((err) => {
    console.warn('[cache] inventory list invalidate failed:', err.message);
  });
}

/** Invalidate all inventory list + count cache entries. */
async function invalidateInventoryListCaches() {
  await Promise.all([
    cacheDelPattern(`inventory:${CACHE_VERSION}:`),
    cacheDelPattern(`inventory_count:${CACHE_VERSION}:`),
  ]);
}

module.exports = {
  LIST_TTL_SEC,
  COUNT_TTL_SEC,
  cacheDisabled,
  buildListCacheKey,
  buildCountCacheKey,
  getCachedList,
  setCachedList,
  getCachedCount,
  setCachedCount,
  invalidateInventoryListCaches,
  invalidateInventoryListCachesFireAndForget,
};
