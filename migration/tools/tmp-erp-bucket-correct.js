const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const { parseJson } = require('../lib/helpers');

function parseJsonArray(raw) {
  const p = parseJson(raw, null);
  return Array.isArray(p) ? p : p != null ? [p] : [];
}

function bucketEligible(dc) {
  const hasJson = (v) => parseJsonArray(v).length > 0;
  return (
    hasJson(dc.rejected_serial_numbers) ||
    hasJson(dc.returned_serial_numbers) ||
    hasJson(dc.pickuped_serial_numbers) ||
    hasJson(dc.old_pickuped_serial_numbers) ||
    String(dc.status || '').toLowerCase() === 'pending'
  );
}

const src = new ErpSqlDumpSource(resolveDumpPath());
const dcs = src.getTableRows('delivery_challans');
const dmen = new Set(src.getTableRows('delivery_men').map((m) => String(m.id)));

// Wrong logic (previous audit)
const wrong = new Set();
for (const dc of dcs) {
  if (dc.delivery_person_id && bucketEligible(dc) && dc.dc_number) wrong.add(dc.dc_number);
}

// ERP parity: join delivery_men — delivery_person_id must be numeric delivery_man id
const correct = new Set();
for (const dc of dcs) {
  const pid = String(dc.delivery_person_id ?? '');
  if (!/^\d+$/.test(pid) || !dmen.has(pid)) continue;
  if (bucketEligible(dc) && dc.dc_number) correct.add(dc.dc_number);
}

console.log('Wrong ERP count (any delivery_person_id):', wrong.size);
console.log('Correct ERP count (valid delivery_man join):', correct.size);
console.log('by_courier pseudo-ids in eligible DCs:', [...dcs].filter((dc) => {
  const pid = String(dc.delivery_person_id ?? '');
  return bucketEligible(dc) && dc.dc_number && pid === 'by_courier';
}).length);

const onlyWrong = [...wrong].filter((n) => !correct.has(n));
console.log('Excluded by join (in wrong not correct):', onlyWrong.length, onlyWrong.slice(0, 15));
