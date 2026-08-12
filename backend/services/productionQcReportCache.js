/**
 * Redis / in-memory cache-aside for Production QC Report list + detail.
 */
const { cacheGet, cacheSet, cacheDelPattern, CACHE_TTL } = require('../utils/cacheService');

const CACHE_VERSION = 'v2';
const LIST_PREFIX = `production_qc_list:${CACHE_VERSION}:`;
const DETAIL_PREFIX = `production_qc_detail:${CACHE_VERSION}:`;

const LIST_TTL_SEC = parseInt(
  process.env.CACHE_TTL_PRODUCTION_QC_LIST_SEC || String(CACHE_TTL.PRODUCTION_QC_LIST || 300),
  10
);
const DETAIL_TTL_SEC = parseInt(
  process.env.CACHE_TTL_PRODUCTION_QC_DETAIL_SEC || String(CACHE_TTL.PRODUCTION_QC_DETAIL || 600),
  10
);

function cacheDisabled() {
  return process.env.PRODUCTION_QC_CACHE === '0' || process.env.PRODUCTION_QC_CACHE === 'false';
}

function sanitizePart(value) {
  if (value == null || value === '') return '-';
  return encodeURIComponent(String(value)).slice(0, 120);
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

const LIST_KEYS = [
  'page', 'limit', 'search', 'q', 'ttspl',
  'date_from', 'date_to', 'dateFrom', 'dateTo',
  'technician_id', 'technicianId',
  'stage', 'qc_stage',
  'qc_status', 'qcStatus', 'status',
  'brand', 'model', 'processor', 'generation', 'ram', 'storage', 'screen_size', 'gpu',
  'for_export',
];

function buildListCacheKey(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(query.for_export ? 2000 : 100, Math.max(1, parseInt(query.limit, 10) || 25));
  const exportFlag = query.for_export ? 'export' : 'list';
  const normalized = {
    ...query,
    page,
    limit,
    search: String(query.search || query.q || query.ttspl || '').trim(),
  };
  return `${LIST_PREFIX}${exportFlag}:${stableQueryKey(normalized, LIST_KEYS)}`;
}

function buildDetailCacheKey(historyId) {
  return `${DETAIL_PREFIX}${sanitizePart(historyId)}`;
}

async function getCachedList(key) {
  if (cacheDisabled() || !key) return undefined;
  return cacheGet(key);
}

async function setCachedList(key, payload) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, payload, LIST_TTL_SEC);
}

async function getCachedDetail(key) {
  if (cacheDisabled() || !key) return undefined;
  return cacheGet(key);
}

async function setCachedDetail(key, payload) {
  if (cacheDisabled() || !key) return;
  await cacheSet(key, payload, DETAIL_TTL_SEC);
}

async function invalidateProductionQcReportCaches() {
  await Promise.all([
    cacheDelPattern(LIST_PREFIX),
    cacheDelPattern(DETAIL_PREFIX),
  ]);
}

function invalidateProductionQcReportCachesFireAndForget() {
  invalidateProductionQcReportCaches().catch((err) => {
    console.warn('[cache] production-qc invalidate failed:', err.message);
  });
}

module.exports = {
  LIST_TTL_SEC,
  DETAIL_TTL_SEC,
  cacheDisabled,
  buildListCacheKey,
  buildDetailCacheKey,
  getCachedList,
  setCachedList,
  getCachedDetail,
  setCachedDetail,
  invalidateProductionQcReportCaches,
  invalidateProductionQcReportCachesFireAndForget,
};
