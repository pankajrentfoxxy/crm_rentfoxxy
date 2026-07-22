/**
 * 019 — ERP customer_rent_devices → CRM vendor_serial_numbers deployment state
 * Backfills current_customer_id + rented/on_demo/sold so customer Assets tabs match ERP.
 *
 * ERP "active with customer" = customer_rent_devices.status='pending' AND no rent_stop_date.
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId } = require('../lib/id-map');
const { str } = require('../lib/helpers');

function parseMoney(raw) {
  const n = Number(String(raw ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mapInventoryStatus(type) {
  const t = str(type, 32, 'rental').toLowerCase();
  if (t === 'demo') return 'on_demo';
  if (t === 'sale' || t === 'sales') return 'sold';
  return 'rented';
}

function parseDate(raw) {
  const s = str(raw, 32, '');
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : `${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : s.slice(0, 10);
}

async function resolveCrmSerialId(crm, row) {
  if (row.serial_id != null) {
    const mapped = await getCrmId(crm, 'serial_numbers', row.serial_id);
    if (mapped != null) return mapped;
  }
  const ttspl = str(row.unique_number, 64, null);
  if (ttspl) {
    const { rows } = await crm.query(
      `SELECT serial_id FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (inventory_asset_code = $1 OR extra->>'unique_product_serial' = $1)
        LIMIT 1`,
      [ttspl]
    );
    if (rows.length) return rows[0].serial_id;
  }
  const sn = str(row.serial_number, 255, '');
  if (sn) {
    const { rows } = await crm.query(
      `SELECT serial_id FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND LOWER(serial_number) = LOWER($1)
        LIMIT 1`,
      [sn]
    );
    if (rows.length) return rows[0].serial_id;
  }
  return null;
}

async function lookupEntityCode(crm, dcNumber) {
  const dc = str(dcNumber, 50, null);
  if (!dc) return 'rentfoxxy';
  const { rows } = await crm.query(
    `SELECT entity_code FROM delivery_challan_lines
      WHERE dc_number = $1 AND entity_code IS NOT NULL
      LIMIT 1`,
    [dc]
  );
  return rows[0]?.entity_code || 'rentfoxxy';
}

module.exports = {
  id: '019',
  name: 'customer_rentals',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query(
      `SELECT COUNT(*) AS cnt FROM customer_rent_devices
        WHERE (rent_stop_date IS NULL OR rent_stop_date = '')
          AND status IN ('pending', 'active')`
    );
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let updated = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, serial_id, customer_id, dc_number, serial_number, unique_number,
              rent_start_date, month_rent, rent_amount, type, status, vendor_id, po_id,
              created_at, updated_at
         FROM customer_rent_devices
        WHERE (rent_stop_date IS NULL OR rent_stop_date = '')
          AND status IN ('pending', 'active')
        ORDER BY id`
    );

    const entityCache = new Map();

    for (const row of rows) {
      processed += 1;

      const crmCustomerId = await getCrmId(crm, 'customers', row.customer_id);
      if (crmCustomerId == null) {
        skipped += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('customer_rentals', processed, total);
        }
        continue;
      }

      const crmSerialId = await resolveCrmSerialId(crm, row);
      if (crmSerialId == null) {
        skipped += 1;
        writeLog('migration', `019 skip rent_device ${row.id}: serial ${row.serial_id} not in CRM`);
        if (processed % batchSize === 0 || processed === total) {
          progress('customer_rentals', processed, total);
        }
        continue;
      }

      const dcNumber = str(row.dc_number, 50, null);
      let entityCode = entityCache.get(dcNumber);
      if (entityCode == null) {
        entityCode = await lookupEntityCode(crm, dcNumber);
        if (dcNumber) entityCache.set(dcNumber, entityCode);
      }

      const inventoryStatus = mapInventoryStatus(row.type);
      const rentStart = parseDate(row.rent_start_date);
      const monthlyRate = parseMoney(row.month_rent ?? row.rent_amount);

      const r = await crm.query(
        `UPDATE vendor_serial_numbers
            SET current_customer_id = $2,
                inventory_status = $3,
                current_dc_number = COALESCE($4, current_dc_number),
                current_entity = COALESCE($5, current_entity),
                rent_start_date = COALESCE($6::date, rent_start_date),
                rent_monthly_rate = COALESCE($7, rent_monthly_rate),
                delivered_at = COALESCE($6::timestamptz, delivered_at, $8::timestamptz),
                status_changed_at = COALESCE(status_changed_at, NOW()),
                updated_at = NOW()
          WHERE serial_id = $1
            AND deleted_at IS NULL`,
        [
          crmSerialId,
          crmCustomerId,
          inventoryStatus,
          dcNumber,
          entityCode,
          rentStart,
          monthlyRate,
          row.created_at || new Date(),
        ]
      );

      if (r.rowCount) updated += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('customer_rentals', processed, total);
      }
    }

    writeLog(
      'migration',
      `019 complete: updated=${updated} skipped=${skipped} erp_active=${total}`
    );
    return updated;
  },
};
