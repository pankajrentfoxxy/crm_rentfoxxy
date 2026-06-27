/**
 * 013 — ERP goods_received_notes + serial_numbers → CRM vendor_goods_received_notes + vendor_serial_numbers
 * GRNs are migrated first (grn_id NOT NULL on serial rows). Links POs to received units via po_id/grn_id/TTSPL.
 */
const { progress, writeLog } = require('../lib/logger');
const { mapRequired } = require('../lib/id-map');
const {
  buildBrandMapFromRows,
  buildSerialConfigExtra,
  indexProductDetailsRows,
  parseLegacyProductIds,
} = require('../lib/erpProductConfig');
const {
  getCrmId,
  setCrmId,
  str,
  parseJson,
  bumpGrnSequence,
  bumpSerialSequence,
} = require('../lib/helpers');

function extractTtsplCode(raw) {
  const s = str(raw, 255, '');
  if (!s) return null;
  const match = s.match(/TTSPL\d+/i);
  if (match) return match[0].toUpperCase();
  return s.length <= 32 ? s : s.slice(0, 32);
}

function parseRentalStartDate(raw) {
  const s = str(raw, 64, '');
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s.slice(0, 10);
}

function mapQcStatus(erpStatus) {
  return str(erpStatus, 64, 'pending').toLowerCase();
}

function mapInventoryStatus(erpStatus, erpStatus2) {
  const s2 = str(erpStatus2, 64, '').toLowerCase();
  if (s2 === 'repared') return 'in_repair';
  if (s2 === 'qc_reject') return 'qc_failed';
  if (s2 === 'replace') return 'replace';
  if (s2) return s2;

  const s = str(erpStatus, 64, 'pending').toLowerCase();
  const map = {
    passed: 'in_stock',
    pending: 'in_stock',
    failed: 'qc_failed',
    out_stock: 'out_stock',
    out_for_repare: 'in_repair',
    out_for_return: 'returned',
  };
  return map[s] || null;
}

function buildSerialExtra(row) {
  const extra = {
    unique_product_serial: row.unique_product_serial,
    product_id: row.product_id != null ? String(row.product_id) : undefined,
    product_warranty: row.product_warranty || undefined,
    status: row.status,
    status2: row.status2 || undefined,
    action_status: row.action_status || undefined,
    action_remark: row.action_remark || undefined,
    came_from: row.came_from || undefined,
    file_path: row.file_path || undefined,
    vendor_name: row.vendor_name || undefined,
    hardware_action: row.hardware_action || undefined,
    hardware_remark: row.hardware_remark || undefined,
    erp_serial_id: row.id,
    is_replaced: row.is_replaced ? 1 : 0,
    is_repaired: row.is_repaired ? 1 : 0,
  };

  const requireParts = parseJson(row.require_parts);
  if (requireParts != null) extra.require_parts = requireParts;
  else if (row.require_parts) extra.require_parts = row.require_parts;

  const requirePartsDone = parseJson(row.require_parts_done);
  if (requirePartsDone != null) extra.require_parts_done = requirePartsDone;
  else if (row.require_parts_done) extra.require_parts_done = row.require_parts_done;

  const oldSerial = parseJson(row.dataoldSerialNumber);
  if (oldSerial != null) {
    extra.dataoldSerialNumber = oldSerial;
    const legacyOld = oldSerial.oldSerial ?? oldSerial.old_serial_number ?? oldSerial.old_serial;
    if (legacyOld != null && String(legacyOld).trim() !== '') {
      extra.old_serial_number = String(legacyOld).trim();
    }
  }

  return Object.fromEntries(
    Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}

async function findExistingSerial(crm, serialNumber, assetCode) {
  const sn = str(serialNumber, 255, '');
  if (sn) {
    const { rows } = await crm.query(
      `SELECT serial_id FROM vendor_serial_numbers
        WHERE LOWER(serial_number) = LOWER($1) AND deleted_at IS NULL
        LIMIT 1`,
      [sn]
    );
    if (rows.length) return rows[0].serial_id;
  }
  if (assetCode) {
    const { rows } = await crm.query(
      `SELECT serial_id FROM vendor_serial_numbers
        WHERE inventory_asset_code = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [assetCode]
    );
    if (rows.length) return rows[0].serial_id;
  }
  return null;
}

async function findInventoryId(crm, assetCode, serialNumber) {
  if (assetCode) {
    const { rows } = await crm.query(
      'SELECT inventory_id FROM inventory WHERE machine_number = $1 LIMIT 1',
      [assetCode]
    );
    if (rows.length) return rows[0].inventory_id;
  }
  const sn = str(serialNumber, 255, '');
  if (sn) {
    const { rows } = await crm.query(
      'SELECT inventory_id FROM inventory WHERE serial_number = $1 LIMIT 1',
      [sn]
    );
    if (rows.length) return rows[0].inventory_id;
  }
  return null;
}

async function migrateGrns({ erp, crm, batchSize }) {
  const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `goods_received_notes`');
  const total = Number(countRows[0].cnt);
  let processed = 0;
  let inserted = 0;
  let mapped = 0;

  const [rows] = await erp.query(
    `SELECT id, grn_number, po_id, received_qty, rental_period, product_warranty, product_id,
            created_at, updated_at
       FROM \`goods_received_notes\`
      ORDER BY id`
  );

  for (const row of rows) {
    processed += 1;

    const existingMap = await getCrmId(crm, 'goods_received_notes', row.id);
    if (existingMap != null) {
      if (processed % batchSize === 0 || processed === total) progress('grn', processed, total);
      continue;
    }

    let crmPoId;
    try {
      crmPoId = await mapRequired(crm, 'purchase_orders', row.po_id);
    } catch {
      writeLog('migration', `013 skip GRN ${row.id}: PO ${row.po_id} not mapped`);
      if (processed % batchSize === 0 || processed === total) progress('grn', processed, total);
      continue;
    }

    const meta = {
      grn_number: row.grn_number,
      received_qty: row.received_qty,
      rental_period: row.rental_period,
      product_warranty: row.product_warranty,
      product_id: row.product_id,
      erp_grn_id: row.id,
    };

    const { rows: ins } = await crm.query(
      `INSERT INTO vendor_goods_received_notes (po_id, bill_status, meta, created_at, updated_at)
       VALUES ($1, 'received', $2::jsonb, $3, $4)
       RETURNING grn_id`,
      [
        crmPoId,
        JSON.stringify(meta),
        row.created_at || new Date(),
        row.updated_at || new Date(),
      ]
    );

    await setCrmId(crm, {
      entity: 'goods_received_notes',
      erpId: row.id,
      crmId: ins[0].grn_id,
      erpTable: 'goods_received_notes',
      crmTable: 'vendor_goods_received_notes',
    });
    inserted += 1;

    if (processed % batchSize === 0 || processed === total) {
      progress('grn', processed, total);
    }
  }

  await bumpGrnSequence(crm);
  writeLog('migration', `013 GRN: inserted=${inserted} mapped=${mapped} total=${total}`);
  return inserted + mapped;
}

async function bumpTtsplSequence(crm) {
  const { rows } = await crm.query(
    `SELECT MAX(
       CAST(NULLIF(REGEXP_REPLACE(inventory_asset_code, '\\D', '', 'g'), '') AS INTEGER)
     ) AS max_num
       FROM vendor_serial_numbers
      WHERE inventory_asset_code ~* '^TTSPL\\d+$'
        AND deleted_at IS NULL`
  );
  const maxNum = Number(rows[0]?.max_num) || 0;
  if (maxNum > 0) {
    await crm.query(
      `UPDATE vendor_inventory_asset_sequence
          SET next_num = GREATEST(next_num, $1)
        WHERE id = 1`,
      [maxNum + 1]
    );
  }
}

async function migrateSerialNumbers({ erp, crm, batchSize }) {
  const [brandRows] = await erp.query('SELECT id, name FROM `brands`');
  const brandMap = buildBrandMapFromRows(brandRows);
  const [pdRows] = await erp.query(
    `SELECT id, brand, model, processor, generation, ram, storage, gpu, screen_size,
            quantity, rate, vendor_locking_period, warranty, remarks
       FROM \`product_details\``
  );
  const productDetailsById = indexProductDetailsRows(pdRows);
  const [poMetaRows] = await erp.query('SELECT id, product_details_id FROM `purchase_orders`');
  const legacyIdsByErpPoId = new Map(
    poMetaRows.map((po) => [String(po.id), parseLegacyProductIds(po.product_details_id)])
  );

  const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `serial_numbers`');
  const total = Number(countRows[0].cnt);
  let processed = 0;
  let inserted = 0;
  let mapped = 0;
  let skipped = 0;
  const usedSerialNumbers = new Set();
  const usedAssetCodes = new Set();

  const [rows] = await erp.query(
    `SELECT id, serial_number, unique_product_serial, product_id, goods_receipts_id, po_id,
            rental_period, product_warranty, dataoldSerialNumber, status, status2,
            action_status, came_from, action_remark, remark, is_replaced, is_repaired,
            require_parts, require_parts_done, file_path, seller_id, vendor_name,
            hardware_action, hardware_remark, hardware_action_by, hardware_action_date,
            created_at, updated_at
       FROM \`serial_numbers\`
      ORDER BY id`
  );

  for (const row of rows) {
    processed += 1;

    const existingMap = await getCrmId(crm, 'serial_numbers', row.id);
    if (existingMap != null) {
      if (processed % batchSize === 0 || processed === total) {
        progress('serial_numbers', processed, total);
      }
      continue;
    }

    let crmPoId;
    let crmGrnId;
    try {
      crmPoId = await mapRequired(crm, 'purchase_orders', row.po_id);
      crmGrnId = await mapRequired(crm, 'goods_received_notes', row.goods_receipts_id);
    } catch (err) {
      skipped += 1;
      writeLog('migration', `013 skip serial ${row.id}: ${err.message}`);
      if (processed % batchSize === 0 || processed === total) {
        progress('serial_numbers', processed, total);
      }
      continue;
    }

    let serialNumber = str(row.serial_number, 255, `ERP-SN-${row.id}`);
    let assetCode = extractTtsplCode(row.unique_product_serial);

    if (usedSerialNumbers.has(serialNumber.toLowerCase())) {
      serialNumber = `${serialNumber.slice(0, 240)}-erp${row.id}`;
    }
    usedSerialNumbers.add(serialNumber.toLowerCase());

    if (assetCode && usedAssetCodes.has(assetCode)) {
      assetCode = null;
    }
    if (assetCode) usedAssetCodes.add(assetCode);

    let crmSerialId = await findExistingSerial(crm, serialNumber, assetCode);
    if (crmSerialId) {
      await setCrmId(crm, {
        entity: 'serial_numbers',
        erpId: row.id,
        crmId: crmSerialId,
        erpTable: 'serial_numbers',
        crmTable: 'vendor_serial_numbers',
      });
      mapped += 1;
    } else {
      const legacyIds = legacyIdsByErpPoId.get(String(row.po_id)) || [];
      const extra = buildSerialConfigExtra({
        serialRow: row,
        legacyIds,
        productDetailsById,
        brandMap,
        baseExtra: buildSerialExtra(row),
      });
      const inventoryId = await findInventoryId(crm, assetCode || row.unique_product_serial, serialNumber);
      if (inventoryId != null) extra.inventory_id = inventoryId;

      const { rows: ins } = await crm.query(
        `INSERT INTO vendor_serial_numbers (
           po_id, grn_id, serial_number, inventory_asset_code, rental_start_date,
           qc_status, inventory_status, remark, extra, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9::jsonb,$10,$11)
         RETURNING serial_id`,
        [
          crmPoId,
          crmGrnId,
          serialNumber,
          assetCode,
          parseRentalStartDate(row.rental_period),
          mapQcStatus(row.status),
          mapInventoryStatus(row.status, row.status2),
          str(row.remark, 5000, null),
          JSON.stringify(extra),
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );

      crmSerialId = ins[0].serial_id;
      await setCrmId(crm, {
        entity: 'serial_numbers',
        erpId: row.id,
        crmId: crmSerialId,
        erpTable: 'serial_numbers',
        crmTable: 'vendor_serial_numbers',
      });
      inserted += 1;
    }

    if (processed % batchSize === 0 || processed === total) {
      progress('serial_numbers', processed, total);
    }
  }

  await bumpSerialSequence(crm);
  await bumpTtsplSequence(crm);
  writeLog(
    'migration',
    `013 serials: inserted=${inserted} mapped=${mapped} skipped=${skipped} total=${total}`
  );
  return inserted + mapped;
}

module.exports = {
  id: '013',
  name: 'serial_numbers',
  async run({ erp, crm, batchSize }) {
    const grnRows = await migrateGrns({ erp, crm, batchSize });
    const serialRows = await migrateSerialNumbers({ erp, crm, batchSize });
    return grnRows + serialRows;
  },
};
