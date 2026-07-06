/**
 * Benchmark inventory list SQL path (no HTTP).
 * Usage: node scripts/bench-inventory-list.js [segment] [modelFilter]
 */
require('dotenv').config();
process.env.INVENTORY_LIST_CACHE = '0';
process.env.PERF_LOG = '1';

const pool = require('../config/db');
const { listInventorySerials } = require('../services/inventoryListService');

async function run(label, options) {
  const t0 = process.hrtime.bigint();
  await listInventorySerials(options);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${label}: ${ms.toFixed(1)}ms`);
  return ms;
}

async function main() {
  const segment = process.argv[2] || 'passed';
  const model = process.argv[3] || '';

  const base = {
    segment,
    page: 1,
    limit: 25,
    offset: 0,
    search: '',
    dateFrom: undefined,
    dateTo: undefined,
    specFilters: model ? { model } : {},
    cursor: undefined,
  };

  await run('warmup', base);
  const cold = await run('cold (no cache)', base);
  await run('repeat (count cached in-memory if enabled)', base);

  await pool.end();
  console.log(`\nTarget: <500ms — ${cold < 500 ? 'PASS' : 'FAIL'} (${cold.toFixed(1)}ms)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
