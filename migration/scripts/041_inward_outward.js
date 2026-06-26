/**
 * 041 — ERP inward_outward → CRM inward_outward (Serial Number Status history).
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, setCrmId, str } = require('../lib/helpers');

function parseOptionalInt(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function mapForeignId(crm, entity, erpIdRaw) {
  const erpId = parseOptionalInt(erpIdRaw);
  if (erpId == null) return null;
  return getCrmId(crm, entity, erpId);
}

module.exports = {
  id: '041',
  name: 'inward_outward',
  async run({ erp, crm, batchSize }) {
    const [rawRows] = await erp.query(
      `SELECT id, serial_id, serial_number, unique_number, customer_id, vendor_id, type,
              product_type, found_in, purpose, remarks, ticket_number, ticket_sla_time,
              technician_id, courier_name, awb_number, spare_parts_serial_number,
              created_at, updated_at
         FROM inward_outward
        ORDER BY id`
    );

    const rows = rawRows.filter(
      (row) => !row.product_type || String(row.product_type).toLowerCase() !== 'parts'
    );
    const total = rows.length;
    let processed = 0;
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'inward_outward', row.id);
      const crmVendorId = await mapForeignId(crm, 'vendors', row.vendor_id);
      const crmCustomerId = await mapForeignId(crm, 'customers', row.customer_id);
      const crmTechnicianId = await mapForeignId(crm, 'delivery_men', row.technician_id);
      const crmSerialId = await mapForeignId(crm, 'serial_numbers', row.serial_id);

      const ioType = str(row.type, 64, null);
      const metaJson = JSON.stringify({
        type: ioType,
        purpose: str(row.purpose, 255, null),
        found_in: str(row.found_in, 128, null),
        migrated: true
      });

      const payload = [
        row.id,
        crmSerialId,
        str(row.serial_number, 255, null),
        str(row.unique_number, 255, null),
        crmCustomerId,
        crmVendorId,
        ioType,
        str(row.product_type, 64, null),
        str(row.found_in, 128, null),
        str(row.purpose, 255, null),
        str(row.remarks, 500, null),
        str(row.ticket_number, 255, null),
        str(row.ticket_sla_time, 64, null),
        crmTechnicianId,
        str(row.courier_name, 255, null),
        str(row.awb_number, 255, null),
        str(row.spare_parts_serial_number, 5000, null),
        'erp',
        ioType,
        metaJson,
        row.created_at || new Date(),
        row.updated_at || row.created_at || new Date()
      ];

      if (existingMap != null) {
        await crm.query(
          `UPDATE inward_outward SET
             vendor_serial_id = $2,
             serial_number = $3,
             unique_number = $4,
             customer_id = $5,
             vendor_id = $6,
             io_type = $7,
             product_type = $8,
             found_in = $9,
             purpose = $10,
             remarks = $11,
             ticket_number = $12,
             ticket_sla_time = $13,
             technician_id = $14,
             courier_name = $15,
             awb_number = $16,
             spare_parts_serial_number = $17,
             source = $18,
             transaction_type = $19,
             meta = $20::jsonb,
             created_at = $21,
             updated_at = $22
           WHERE erp_id = $1`,
          payload
        );
        updated += 1;
      } else {
        const { rows: ins } = await crm.query(
          `INSERT INTO inward_outward (
             erp_id, vendor_serial_id, serial_number, unique_number, customer_id, vendor_id,
             io_type, product_type, found_in, purpose, remarks, ticket_number, ticket_sla_time,
             technician_id, courier_name, awb_number, spare_parts_serial_number, source,
             transaction_type, meta, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22
           ) RETURNING id`,
          payload
        );

        await setCrmId(crm, {
          entity: 'inward_outward',
          erpId: row.id,
          crmId: ins[0].id,
          erpTable: 'inward_outward',
          crmTable: 'inward_outward'
        });
        inserted += 1;
      }

      if (processed % batchSize === 0 || processed === total) {
        progress('inward_outward', processed, total);
      }
    }

    writeLog('migration', `041 complete: inserted=${inserted} updated=${updated} total=${total}`);
    return inserted + updated;
  }
};
