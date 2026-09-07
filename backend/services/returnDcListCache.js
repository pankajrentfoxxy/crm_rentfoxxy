/**
 * Redis / in-memory cache-aside for Return DC list, stats, and column filters.
 */
const { cacheGet, cacheSet, cacheDelPattern } = require('../utils/cacheService');

const CACHE_VERSION = 'v1';
const PREFIX = `rdc:${CACHE_VERSION}:`;
const LIST_TTL_SEC = parseInt(process.env.CACHE_TTL_RETURN_DC_LIST_SEC || '25', 10);
const STATS_TTL_SEC = parseInt(process.env.CACHE_TTL_RETURN_DC_STATS_SEC || '30', 10);
const COL_TTL_SEC = parseInt(process.env.CACHE_TTL_RETURN_DC_COLUMNS_SEC || '60', 10);

function cacheDisabled() {
  return process.env.RETURN_DC_LIST_CACHE === '0' || process.env.RETURN_DC_LIST_CACHE === 'false';
}

function sanitizePart(value) {
  if (value == null || value === '') return '-';
  return encodeURIComponent(String(value)).slice(0, 160);
}

function stableQueryKey(query = {}) {
  const skip = new Set(['page', 'limit', 'tab']);
  const parts = Object.keys(query)
    .filter((k) => !skip.has(k) && query[k] != null && String(query[k]).trim() !== '')
    .sort()
    .map((k) => `${k}=${sanitizePart(query[k])}`);
  return parts.length ? parts.join('&') : '-';
}

function buildListCacheKey({
  page,
  limit,
  search,
  dateFrom,
  dateTo,
  status,
  assignedUserId,
  warehouseReceive,
  technician,
  columnFiltersQuery,
}) {
  return [
    `${PREFIX}list`,
    sanitizePart(assignedUserId || 'all'),
    page || 1,
    limit || 25,
    sanitizePart(search),
    sanitizePart(dateFrom),
    sanitizePart(dateTo),
    sanitizePart(status || 'all'),
    sanitizePart(warehouseReceive),
    sanitizePart(technician),
    stableQueryKey(columnFiltersQuery),
  ].join(':');
}

function buildStatsCacheKey({ search, dateFrom, dateTo, assignedUserId }) {
  return [
    `${PREFIX}stats`,
    sanitizePart(assignedUserId || 'all'),
    sanitizePart(search),
    sanitizePart(dateFrom),
    sanitizePart(dateTo),
  ].join(':');
}

function buildColumnCacheKey({
  column,
  search,
  dateFrom,
  dateTo,
  status,
  assignedUserId,
  warehouseReceive,
  technician,
  columnFiltersQuery,
}) {
  return [
    `${PREFIX}col`,
    sanitizePart(column),
    sanitizePart(assignedUserId || 'all'),
    sanitizePart(search),
    sanitizePart(dateFrom),
    sanitizePart(dateTo),
    sanitizePart(status || 'all'),
    sanitizePart(warehouseReceive),
    sanitizePart(technician),
    stableQueryKey(columnFiltersQuery),
  ].join(':');
}

async function getCached(key) {
  if (cacheDisabled() || !key) return undefined;
  return cacheGet(key);
}

async function setCachedList(key, payload) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, payload, LIST_TTL_SEC);
}

async function setCachedStats(key, payload) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, payload, STATS_TTL_SEC);
}

async function setCachedColumns(key, payload) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, payload, COL_TTL_SEC);
}

function invalidateReturnDcListCaches() {
  return cacheDelPattern(PREFIX).catch((err) => {
    console.warn('[cache] return DC list invalidate failed:', err.message);
  });
}

function invalidateReturnDcListCachesFireAndForget() {
  invalidateReturnDcListCaches();
}

module.exports = {
  LIST_TTL_SEC,
  buildListCacheKey,
  buildStatsCacheKey,
  buildColumnCacheKey,
  getCached,
  setCachedList,
  setCachedStats,
  setCachedColumns,
  invalidateReturnDcListCaches,
  invalidateReturnDcListCachesFireAndForget,
};
