/**
 * 026 — ERP allocation_logs → CRM allocation_logs
 * Direct mapping with vendor/customer/user id remapping via erp_id_map.
 */
const { progress, writeLog } = require('../lib/logger');
const {
  getCrmId,
  setCrmId,
  str,
  parseJson,
  bumpAllocationLogSequence,
} = require('../lib/helpers');

function parseOptionalInt(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function buildExtra(row) {
  const extra = {};
  const details = parseJson(row.extra_details, null);
  if (details && typeof details === 'object') Object.assign(extra, details);
  if (row.logType) extra.logType = row.logType;
  if (row.require_parts) extra.require_parts = row.require_parts;
  if (row.file_path) extra.file_path = row.file_path;
  if (row.challan_id) extra.challan_id = row.challan_id;
  return extra;
}

async function resolveVendorId(crm, vendorIdRaw) {
  const n = parseOptionalInt(vendorIdRaw);
  if (n == null) return null;
  return getCrmId(crm, 'vendors', n);
}

module.exports = {
  id: '026',
  name: 'allocation_logs',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `allocation_logs`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;

    const [rows] = await erp.query(
      `SELECT id, user_id, vendor_name, vendor_id, customer_id, customer_name, challan_id,
              product_id, model_name, serial_number, old_serial_number, unique_id, action_taken,
              remarks, po_type, purchase_type, qc_status, locking_period, added_date,
              failure_reason, checked_by, assigned_to, warranty_status, rental_status,
              in_ward, out_ward, require_parts, file_path, logType, created_at, updated_at,
              extra_details
         FROM \`allocation_logs\`
        ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'allocation_logs', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) {
          progress('allocation_logs', processed, total);
        }
        continue;
      }

      const serialNumber = str(row.serial_number, 255, `ERP-AL-${row.id}`);
      const crmVendorId = await resolveVendorId(crm, row.vendor_id);
      const crmCustomerId =
        row.customer_id != null ? await getCrmId(crm, 'customers', row.customer_id) : null;
      const crmUserId = row.user_id != null ? await getCrmId(crm, 'users', row.user_id) : null;
      const crmCheckedBy =
        row.checked_by != null ? await getCrmId(crm, 'users', row.checked_by) : null;
      const crmAssignedTo =
        row.assigned_to != null ? await getCrmId(crm, 'users', row.assigned_to) : null;
      const extra = buildExtra(row);
      const extraDetails = parseJson(row.extra_details, null);
      const detailsJson =
        extraDetails && typeof extraDetails === 'object' && !Array.isArray(extraDetails)
          ? extraDetails
          : extra;

      const { rows: ins } = await crm.query(
        `INSERT INTO allocation_logs (
           vendor_id, vendor_name, serial_number, unique_id, action_taken, remarks,
           qc_status, in_ward, out_ward, extra, user_id, customer_id, customer_name,
           challan_id, product_id, model_name, old_serial_number, po_type, purchase_type,
           locking_period, added_date, failure_reason, checked_by, assigned_to,
           warranty_status, rental_status, extra_details, require_parts, file_path, log_type,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28,$29,$30,$31,$32
         ) RETURNING id`,
        [
          crmVendorId,
          str(row.vendor_name, 255, null),
          serialNumber,
          str(row.unique_id, 255, null),
          str(row.action_taken, 128, null),
          str(row.remarks, 10000, null),
          str(row.qc_status, 64, null),
          str(row.in_ward, 32, null),
          str(row.out_ward, 32, null),
          JSON.stringify(extra),
          crmUserId,
          crmCustomerId,
          str(row.customer_name, 255, null),
          parseOptionalInt(row.challan_id),
          row.product_id != null ? Number(row.product_id) : null,
          str(row.model_name, 255, null),
          str(row.old_serial_number, 255, null),
          str(row.po_type, 64, null),
          str(row.purchase_type, 64, null),
          row.locking_period != null ? Number(row.locking_period) : null,
          row.added_date ? new Date(row.added_date) : null,
          str(row.failure_reason, 10000, null),
          crmCheckedBy,
          crmAssignedTo,
          str(row.warranty_status, 128, null),
          str(row.rental_status, 128, null),
          JSON.stringify(detailsJson),
          str(row.require_parts, 2000, null),
          str(row.file_path, 2000, null),
          str(row.logType, 64, null),
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );

      await setCrmId(crm, {
        entity: 'allocation_logs',
        erpId: row.id,
        crmId: ins[0].id,
        erpTable: 'allocation_logs',
        crmTable: 'allocation_logs',
      });
      inserted += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('allocation_logs', processed, total);
      }
    }

    await bumpAllocationLogSequence(crm);
    writeLog('migration', `026 complete: inserted=${inserted} total=${total}`);
    return inserted;
  },
};
