/**
 * Inventory list orchestration — cache-aside, parallel SQL, enrichment.
 */
const pool = require('../config/db');
const { listTitleForSegment, enrichSerialRowsBatch } = require('./inventoryManagementService');
const {
  buildListCacheKey,
  buildCountCacheKey,
  getCachedList,
  setCachedList,
  getCachedCount,
  setCachedCount,
} = require('./inventoryListCache');
const { countInventoryRows, fetchInventoryPage } = require('../repositories/inventoryListRepository');
const { createPerfLogger } = require('../utils/performanceLogger');

async function listInventorySerials(options) {
  const {
    segment,
    page,
    limit,
    offset,
    search,
    dateFrom,
    dateTo,
    specFilters,
    cursor,
  } = options;

  const perf = createPerfLogger(`inventory.list.${segment}`);
  perf.start('total');

  const listKey = buildListCacheKey({
    segment, page, limit, search, dateFrom, dateTo, specFilters, cursor,
  });
  const countKey = buildCountCacheKey({
    segment, search, dateFrom, dateTo, specFilters,
  });

  perf.start('cache_read');
  const cached = await getCachedList(listKey);
  perf.end('cache_read');
  if (cached) {
    perf.end('total');
    perf.log({ cache: 'hit', segment });
    return { payload: cached, perf: perf.summary(), cacheHit: true };
  }

  perf.start('sql');
  const rowsPromise = fetchInventoryPage({
    segment, limit, offset, search, dateFrom, dateTo, specFilters, cursor,
  });
  const cachedTotal = await getCachedCount(countKey);

  let total;
  let rows;
  if (cachedTotal !== undefined) {
    total = cachedTotal;
    rows = await rowsPromise;
  } else {
    [total, rows] = await Promise.all([
      countInventoryRows({ segment, search, dateFrom, dateTo, specFilters }),
      rowsPromise,
    ]);
    await setCachedCount(countKey, total);
  }
  perf.end('sql');

  perf.start('enrichment');
  const data = await enrichSerialRowsBatch(pool, rows);
  perf.end('enrichment');

  const payload = buildResponse({
    segment,
    data,
    page,
    limit,
    total,
    rows,
    cursor,
  });

  perf.start('cache_write');
  await setCachedList(listKey, payload);
  perf.end('cache_write');

  perf.end('total');
  perf.log({ cache: 'miss', segment, countCache: cachedTotal !== undefined ? 'hit' : 'miss' });
  return { payload, perf: perf.summary(), cacheHit: false };
}

function buildResponse({ segment, data, page, limit, total, rows, cursor }) {
  const pagination = {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
  if (cursor && rows.length) {
    const last = rows[rows.length - 1];
    pagination.nextCursor = last.serial_updated_at || last.updated_at;
  }
  return {
    success: true,
    segment,
    title: listTitleForSegment(segment),
    data,
    pagination,
  };
}

module.exports = { listInventorySerials };
