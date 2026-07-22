/**
 * 010 — ERP purchase_orders → CRM vendor_purchase_orders
 * Additive: idempotent via erp_id_map; dedupe by purchase_order_number.
 */
const { progress, writeLog } = require('../lib/logger');
const { mapRequired } = require('../lib/id-map');
const {
  buildBrandMapFromRows,
  indexProductDetailsRows,
  parseLegacyProductIds,
  resolvePoLineItems,
} = require('../lib/erpProductConfig');
const {
  getCrmId,
  setCrmId,
  str,
  parseJson,
  bumpPoSequence,
} = require('../lib/helpers');

const VALID_PO_TYPES = new Set(['rental_purchase', 'rent_to_own', 'direct_purchase']);

function mapPoStatus(erpStatus) {
  const s = str(erpStatus, 64, 'pending').toLowerCase();
  const map = {
    pending: 'draft',
    processing: 'processing',
    completed: 'completed',
    void: 'void',
    approved: 'approved',
  };
  return map[s] || s;
}

function mapPoType(raw) {
  const t = str(raw, 64, 'direct_purchase').toLowerCase();
  if (VALID_PO_TYPES.has(t)) return t;
  if (t.includes('rental')) return 'rental_purchase';
  if (t.includes('rent_to_own') || t.includes('rto')) return 'rent_to_own';
  return 'direct_purchase';
}

function parseBillFiles(raw) {
  const parsed = parseJson(raw, null);
  if (Array.isArray(parsed)) return parsed;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [raw.trim()];
    } catch {
      return [raw.trim()];
    }
  }
  return [];
}

function parseAssetsJson(raw) {
  const parsed = parseJson(raw, null);
  if (parsed == null) return null;
  return parsed;
}

async function findExistingPoByNumber(crm, poNumber) {
  const num = str(poNumber, 64, '');
  if (!num) return null;
  const { rows } = await crm.query(
    `SELECT po_id FROM vendor_purchase_orders
      WHERE purchase_order_number = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [num]
  );
  return rows[0]?.po_id ?? null;
}

module.exports = {
  id: '010',
  name: 'purchase_orders',
  async run({ erp, crm, batchSize }) {
    const [brandRows] = await erp.query('SELECT id, name FROM `brands`');
    const brandMap = buildBrandMapFromRows(brandRows);
    const [pdRows] = await erp.query(
      `SELECT id, brand, model, processor, generation, ram, storage, gpu, screen_size,
              quantity, rate, vendor_locking_period, warranty, remarks
         FROM \`product_details\``
    );
    const productDetailsById = indexProductDetailsRows(pdRows);

    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `purchase_orders`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let mapped = 0;
    let skippedVendor = 0;

    const [rows] = await erp.query(
      `SELECT id, purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, state,
              product_details_id, locking_period, assets_details, remarks,
              sub_total_amount, total_amount, isSameState, status, invoice_created, invoice_path,
              token, status_updated_by_id, status_updated_by_name, bill_name, bill_files,
              created_at, updated_at
         FROM \`purchase_orders\`
        ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'purchase_orders', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) progress('purchase_orders', processed, total);
        continue;
      }

      let crmVendorId;
      try {
        crmVendorId = await mapRequired(crm, 'vendors', row.vendor_id);
      } catch {
        skippedVendor += 1;
        writeLog('migration', `010 skip PO ${row.id}: vendor ${row.vendor_id} not mapped`);
        if (processed % batchSize === 0 || processed === total) progress('purchase_orders', processed, total);
        continue;
      }

      const poNumber = str(row.purchase_order_number, 64, `PO-ERP-${row.id}`);
      let crmPoId = await findExistingPoByNumber(crm, poNumber);

      // Same PO number in ERP can refer to different ERP rows — keep a distinct CRM row per erp id.
      if (crmPoId) {
        const mappedErp = await crm.query(
          `SELECT erp_id FROM erp_id_map WHERE entity = 'purchase_orders' AND crm_id = $1 LIMIT 1`,
          [String(crmPoId)]
        );
        if (mappedErp.rows[0]?.erp_id && mappedErp.rows[0].erp_id !== String(row.id)) {
          crmPoId = null;
        }
      }

      if (crmPoId) {
        await setCrmId(crm, {
          entity: 'purchase_orders',
          erpId: row.id,
          crmId: crmPoId,
          erpTable: 'purchase_orders',
          crmTable: 'vendor_purchase_orders',
        });
        mapped += 1;
      } else {
        const assetsRaw = parseAssetsJson(row.assets_details);
        const legacyIds = parseLegacyProductIds(row.product_details_id);
        const lineItems = resolvePoLineItems({
          assetsRaw: assetsRaw ?? row.assets_details,
          legacyIdsRaw: row.product_details_id,
          productDetailsById,
          brandMap,
        });
        const billFiles = parseBillFiles(row.bill_files);
        const statusUpdatedBy =
          row.status_updated_by_id != null
            ? await getCrmId(crm, 'users', row.status_updated_by_id)
            : null;

        const { rows: ins } = await crm.query(
          `INSERT INTO vendor_purchase_orders (
             purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state,
             is_same_state, sub_total_amount, total_amount, line_items, assets_details,
             product_details_legacy_ids, remarks, status, invoice_created, invoice_path,
             rental_period, status_updated_by_admin_id, status_updated_by_name,
             bill_name, bill_files, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22
           ) RETURNING po_id`,
          [
            poNumber,
            row.purchase_order_date,
            mapPoType(row.purchase_order_type),
            crmVendorId,
            str(row.state, 128, 'NA'),
            Boolean(row.isSameState),
            Number(row.sub_total_amount) || 0,
            Number(row.total_amount) || 0,
            JSON.stringify(lineItems),
            JSON.stringify(assetsRaw ?? []),
            JSON.stringify(legacyIds),
            str(row.remarks, 10000, null),
            mapPoStatus(row.status),
            String(row.invoice_created || '').toLowerCase() === 'completed',
            str(row.invoice_path, 2000, null),
            str(row.locking_period, 128, null),
            statusUpdatedBy,
            str(row.status_updated_by_name, 255, null),
            str(row.bill_name, 255, null),
            JSON.stringify(billFiles),
            row.created_at || new Date(),
            row.updated_at || new Date(),
          ]
        );

        crmPoId = ins[0].po_id;
        await setCrmId(crm, {
          entity: 'purchase_orders',
          erpId: row.id,
          crmId: crmPoId,
          erpTable: 'purchase_orders',
          crmTable: 'vendor_purchase_orders',
        });
        inserted += 1;
      }

      if (processed % batchSize === 0 || processed === total) {
        progress('purchase_orders', processed, total);
      }
    }

    await bumpPoSequence(crm);
    writeLog(
      'migration',
      `010 complete: inserted=${inserted} mapped=${mapped} skipped_vendor=${skippedVendor} total=${total}`
    );
    return inserted + mapped;
  },
};
