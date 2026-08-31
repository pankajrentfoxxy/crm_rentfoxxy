/**
 * Redis / in-memory cache-aside for Master Data Dashboard (KPIs + tab payloads).
 */
const { cacheGet, cacheSet, cacheDelPattern, CACHE_TTL } = require('../utils/cacheService');

const CACHE_VERSION = 'v5';
const PREFIX = `master_data:${CACHE_VERSION}:`;
const KPI_PREFIX = `master_data_kpi:${CACHE_VERSION}:`;

const DASHBOARD_TTL_SEC = parseInt(
  process.env.CACHE_TTL_MASTER_DATA_SEC || String(CACHE_TTL.MASTER_DATA || 120),
  10
);
const KPI_TTL_SEC = parseInt(
  process.env.CACHE_TTL_MASTER_DATA_KPI_SEC || String(CACHE_TTL.MASTER_DATA_KPI || 180),
  10
);

function cacheDisabled() {
  return process.env.MASTER_DATA_CACHE === '0' || process.env.MASTER_DATA_CACHE === 'false';
}

function sanitizePart(value) {
  if (value == null || value === '') return '-';
  return encodeURIComponent(String(value)).slice(0, 160);
}

function stableQueryKey(query = {}, keys) {
  const parts = keys
    .map((k) => {
      const v = query[k];
      if (v == null || v === '' || v === false) return null;
      return `${k}=${sanitizePart(v)}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join('&') : '-';
}

const DASHBOARD_KEYS = [
  'tab', 'page', 'limit', 'search', 'status', 'location', 'stage', 'entity',
  'customer_id', 'vendor_id', 'from_vendor', 'ready', 'qc_process', 'pricing_type', 'pricingType',
  'date_mode', 'dateMode', 'month', 'date_from', 'date_to', 'dateFrom', 'dateTo',
  'brand', 'model', 'processor', 'generation', 'ram', 'storage', 'screen_size', 'gpu',
];

/** KPI query ignores list drill-downs — keep key aligned with getKpis(). */
const KPI_KEYS = [
  'search', 'pricing_type', 'pricingType',
  'date_mode', 'dateMode', 'month', 'date_from', 'date_to', 'dateFrom', 'dateTo',
  'brand', 'model', 'processor', 'generation', 'ram', 'storage', 'screen_size', 'gpu',
];

function buildDashboardCacheKey(query = {}) {
  return `${PREFIX}${stableQueryKey(query, DASHBOARD_KEYS)}`;
}

function buildKpiCacheKey(query = {}) {
  return `${KPI_PREFIX}${stableQueryKey(query, KPI_KEYS)}`;
}

async function getCachedDashboard(key) {
  if (cacheDisabled() || !key) return undefined;
  return cacheGet(key);
}

async function setCachedDashboard(key, payload) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, payload, DASHBOARD_TTL_SEC);
}

async function getCachedKpis(key) {
  if (cacheDisabled() || !key) return undefined;
  return cacheGet(key);
}

async function setCachedKpis(key, payload) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, payload, KPI_TTL_SEC);
}

async function invalidateMasterDataCaches() {
  await Promise.all([
    cacheDelPattern(PREFIX),
    cacheDelPattern(KPI_PREFIX),
  ]);
}

function invalidateMasterDataCachesFireAndForget() {
  invalidateMasterDataCaches().catch((err) => {
    console.warn('[cache] master-data invalidate failed:', err.message);
  });
}

module.exports = {
  DASHBOARD_TTL_SEC,
  KPI_TTL_SEC,
  cacheDisabled,
  buildDashboardCacheKey,
  buildKpiCacheKey,
  getCachedDashboard,
  setCachedDashboard,
  getCachedKpis,
  setCachedKpis,
  invalidateMasterDataCaches,
  invalidateMasterDataCachesFireAndForget,
};
