require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
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

(async () => {
  const c = getCrmPool();
  const erpDcs = new ErpSqlDumpSource(resolveDumpPath()).getTableRows('delivery_challans');
  const erpMen = new Set(
    new ErpSqlDumpSource(resolveDumpPath()).getTableRows('delivery_men').map((m) => Number(m.id))
  );

  const erpCount = new Set();
  for (const dc of erpDcs) {
    const pid = Number(dc.delivery_person_id);
    if (!erpMen.has(pid) || !bucketEligible(dc) || !dc.dc_number) continue;
    erpCount.add(dc.dc_number);
  }

  const tech = await c.query(`SELECT technician_id, user_id FROM delivery_technicians`);
  const allowed = new Set();
  for (const t of tech.rows) {
    allowed.add(Number(t.technician_id));
    if (t.user_id) allowed.add(Number(t.user_id));
  }

  const crmLines = await c.query(`
    SELECT DISTINCT d.dc_number, d.delivery_person_id
    FROM delivery_challan_lines d
    WHERE COALESCE(d.movement_type, 'outbound') = 'outbound'
      AND d.delivery_person_id IS NOT NULL
      AND (
        COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
        OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
        OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
        OR d.status = 'pending'
      )
  `);

  const crmSvc = crmLines.rows.filter((r) => allowed.has(Number(r.delivery_person_id)));
  const crmSvcSet = new Set(crmSvc.map((r) => r.dc_number));

  const missing = [...erpCount].filter((n) => !crmSvcSet.has(n));
  const extra = [...crmSvcSet].filter((n) => !erpCount.has(n));

  console.log('ERP bucket (correct):', erpCount.size);
  console.log('CRM service-equivalent:', crmSvcSet.size);
  console.log('Missing in CRM:', missing.length, missing.slice(0, 20));
  console.log('Extra in CRM:', extra.length, extra.slice(0, 20));

  await closePools();
})();
