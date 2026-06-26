const { loadTableFromDump, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const fs = require('fs');

async function main() {
  const sql = fs.readFileSync(resolveDumpPath(), 'utf8');
  const rows = loadTableFromDump(sql, 'inward_outward');
  const want = new Set([15412, 15660, 15911, 15919, 16004, 16672]);
  const hit = rows.filter((r) => want.has(Number(r.id)));
  console.log('dump hits', hit.length, hit.map((r) => ({ id: r.id, type: r.type, purpose: r.purpose })));
  console.log('max id', rows[rows.length - 1]?.id, 'total', rows.length);
  const pickup = rows.filter((r) => String(r.type).toLowerCase() === 'pickup');
  console.log('pickup rows in dump parse:', pickup.length);
}

main().catch(console.error);
