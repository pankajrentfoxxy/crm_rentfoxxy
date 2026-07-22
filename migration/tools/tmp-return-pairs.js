const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');

function parseJsonArray(raw) {
  if (!raw) return [];
  let s = raw;
  if (typeof s === 'string') {
    s = s.trim();
    if (!s || s === 'null' || s === '[]') return [];
    try {
      const p = JSON.parse(s);
      return Array.isArray(p) ? p : [];
    } catch {
      try {
        const p = JSON.parse(s.replace(/\\"/g, '"'));
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
  }
  return Array.isArray(s) ? s : [];
}

const src = new ErpSqlDumpSource(resolveDumpPath());
const dcs = src.getTableRows('delivery_challans');
const pairs = new Set();
for (const row of dcs) {
  const combined = [
    ...parseJsonArray(row.pickuped_serial_numbers),
    ...parseJsonArray(row.old_pickuped_serial_numbers),
  ];
  if (!combined.length) continue;
  for (const item of combined) {
    const parts = String(item).split('|');
    if (parts[1] && parts[2]) {
      pairs.add(`${parts[1]}-${parts[2]}`);
    }
  }
}
console.log('ERP getAllSerialPairsFromChallan unique pairs', pairs.size);
console.log('DC rows with pickup json', dcs.filter((r) => parseJsonArray(r.pickuped_serial_numbers).length || parseJsonArray(r.old_pickuped_serial_numbers).length).length);
