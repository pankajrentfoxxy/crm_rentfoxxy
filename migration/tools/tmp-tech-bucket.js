require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');

function parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      try {
        const p = JSON.parse(raw.replace(/\\"/g, '"'));
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
  }
  return [];
}

(async () => {
  const erp = new ErpSqlDumpSource(resolveDumpPath());
  const crm = getCrmPool();
  const dcs = erp.getTableRows('delivery_challans');
  const erpSet = new Set();
  for (const dc of dcs) {
    if (!dc.delivery_person_id) continue;
    const hasJson = (v) => parseJsonArray(v).length > 0;
    const hit =
      hasJson(dc.rejected_serial_numbers) ||
      hasJson(dc.returned_serial_numbers) ||
      hasJson(dc.pickuped_serial_numbers) ||
      hasJson(dc.old_pickuped_serial_numbers) ||
      String(dc.status || '').toLowerCase() === 'pending';
    if (hit && dc.dc_number) erpSet.add(dc.dc_number);
  }

  const crmR = await crm.query(`
    SELECT DISTINCT dc_number FROM delivery_challan_lines d
    WHERE d.delivery_person_id IS NOT NULL
      AND COALESCE(d.movement_type, 'outbound') = 'outbound'
      AND (
        COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
        OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
        OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
        OR d.status = 'pending'
      )
  `);
  const crmSet = new Set(crmR.rows.map((r) => r.dc_number));
  console.log('Technician bucket ERP distinct DC', erpSet.size, 'CRM', crmSet.size);
  const missing = [...erpSet].filter((n) => !crmSet.has(n));
  const extra = [...crmSet].filter((n) => !erpSet.has(n));
  console.log('Missing', missing.length, missing.slice(0, 10));
  console.log('Extra', extra.length, extra.slice(0, 10));
  await closePools();
})();
