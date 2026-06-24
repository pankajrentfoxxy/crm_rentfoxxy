/**
 * 032 — Full spare parts resync from ERP.
 *
 * Fixes Issue 2: Parts Purchase Orders missing in CRM.
 *
 * Actions:
 *   1. Upsert vendor_spare_parts_catalog from ERP spare_parts
 *   2. Upsert vendor_spare_parts_purchase_orders from ERP spare_parts_po (476 rows)
 *   3. Migrate ERP goods_received_notes_parts → vendor_goods_received_notes (spo_id)
 *   4. Migrate ERP serial_number_parts → vendor_serial_numbers (spo_id)
 *   5. Seed floor `parts` catalog from spare_parts for /inventory-management/parts
 *
 * Idempotent: uses erp_id_map + purchase_order_number dedup; updates existing SPO rows.
 */
const { progress, writeLog } = require('../lib/logger');
const { mapRequired } = require('../lib/id-map');
const { parseJsonValue } = require('../lib/laravelAssets');
const {
  getCrmId,
  setCrmId,
  str,
  parseJson,
  bumpSpoSequence,
  bumpGrnSequence,
  bumpSerialSequence,
} = require('../lib/helpers');

const BACKUP_TABLE = 'vendor_spare_parts_po_backup_032';

function mapSpoStatus(erpStatus) {
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

function lineSubtotal(lineItems) {
  let s = 0;
  for (const row of lineItems) {
    s += (Number(row.quantity) || 0) * (Number(row.rate) || 0);
  }
  return Math.round(s * 100) / 100;
}

function totalWithGst(subtotal) {
  const s = Number(subtotal) || 0;
  return Math.round((s * 1.18) * 100) / 100;
}

function parseSpareLineItems(row, spareNames, brandNames) {
  const assets = parseJsonValue(row.assets_details);
  const pdIds = parseJson(row.product_details_id, []);
  if (!assets || typeof assets !== 'object') return [];

  const parts = Array.isArray(assets.parts) ? assets.parts : [assets.parts].filter(Boolean);
  const count = parts.length;
  const lines = [];

  for (let i = 0; i < count; i += 1) {
    const erpPartId = parts[i];
    const erpBrandId = Array.isArray(assets.brand) ? assets.brand[i] : assets.brand;
    const qty = Number(Array.isArray(assets.quantity) ? assets.quantity[i] : assets.quantity) || 1;
    const rate = Number(Array.isArray(assets.rate) ? assets.rate[i] : assets.rate) || 0;
    const warranty = Number(Array.isArray(assets.warranty) ? assets.warranty[i] : assets.warranty) || 0;
    const pdId = Array.isArray(pdIds) ? pdIds[i] : null;

    lines.push({
      product_detail_id: pdId,
      erp_product_detail_id: pdId,
      brand_id: erpBrandId != null ? Number(erpBrandId) || erpBrandId : null,
      brand_name: brandNames.get(String(erpBrandId)) || (erpBrandId != null ? String(erpBrandId) : ''),
      erp_spare_part_id: erpPartId != null ? Number(erpPartId) || erpPartId : null,
      part_id: null,
      spare_part_name: spareNames.get(String(erpPartId)) || `Part ${erpPartId}`,
      warranty_months: warranty,
      quantity: qty,
      rate,
      receivedQty: 0,
    });
  }
  return lines;
}

async function loadNameMaps(erp) {
  const spareNames = new Map();
  const brandNames = new Map();

  const [spareRows] = await erp.query('SELECT id, name FROM spare_parts');
  for (const r of spareRows) spareNames.set(String(r.id), str(r.name, 255, `Part ${r.id}`));

  try {
    const [brandRows] = await erp.query('SELECT id, name FROM brands');
    for (const r of brandRows) brandNames.set(String(r.id), str(r.name, 255, String(r.id)));
  } catch {
    /* optional */
  }

  return { spareNames, brandNames };
}

async function upsertCatalog({ erp, crm, batchSize }) {
  const [rows] = await erp.query(
    'SELECT id, name, type, status, created_at, updated_at FROM spare_parts ORDER BY id'
  );
  let inserted = 0;
  let updated = 0;
  let processed = 0;
  const total = rows.length;

  for (const row of rows) {
    processed += 1;
    const name = str(row.name, 255, `Part ${row.id}`);
    const active = !['0', 'inactive', 'void'].includes(String(row.status).toLowerCase());

    let crmPartId = await getCrmId(crm, 'spare_parts', row.id);
    if (crmPartId == null) {
      const { rows: dup } = await crm.query(
        `SELECT part_id FROM vendor_spare_parts_catalog WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [name]
      );
      if (dup.length) {
        crmPartId = dup[0].part_id;
      } else {
        const { rows: ins } = await crm.query(
          `INSERT INTO vendor_spare_parts_catalog (name, active, created_at, updated_at)
           VALUES ($1, $2, $3, $4) RETURNING part_id`,
          [name, active, row.created_at || new Date(), row.updated_at || new Date()]
        );
        crmPartId = ins[0].part_id;
        inserted += 1;
      }
      await setCrmId(crm, {
        entity: 'spare_parts',
        erpId: row.id,
        crmId: crmPartId,
        erpTable: 'spare_parts',
        crmTable: 'vendor_spare_parts_catalog',
      });
    } else {
      await crm.query(
        `UPDATE vendor_spare_parts_catalog SET name = $2, active = $3, updated_at = $4 WHERE part_id = $1`,
        [crmPartId, name, active, row.updated_at || new Date()]
      );
      updated += 1;
    }

    if (processed % batchSize === 0 || processed === total) {
      progress('spare_parts_catalog', processed, total);
    }
  }

  writeLog('migration', `032 catalog: inserted=${inserted} updated=${updated} total=${total}`);
  return inserted + updated;
}

async function findExistingSpoByNumber(crm, poNumber) {
  const num = str(poNumber, 64, '');
  if (!num) return null;
  const { rows } = await crm.query(
    `SELECT spo_id FROM vendor_spare_parts_purchase_orders
      WHERE purchase_order_number = $1 AND deleted_at IS NULL LIMIT 1`,
    [num]
  );
  return rows[0]?.spo_id ?? null;
}

async function ensureSpoBackupTable(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
      spo_id BIGINT PRIMARY KEY,
      row_snapshot JSONB NOT NULL,
      backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function upsertSparePos({ erp, crm, batchSize, spareNames, brandNames }) {
  await ensureSpoBackupTable(crm);

  const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM spare_parts_po');
  const total = Number(countRows[0].cnt);
  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const [rows] = await erp.query(
    `SELECT id, purchase_order_number, purchase_order_date, vendor_id, product_details_id,
            assets_details, remarks, status, status_updated_by_id, status_updated_by_name,
            bill_name, bill_files, created_at, updated_at
       FROM spare_parts_po ORDER BY id`
  );

  for (const row of rows) {
    processed += 1;

    let crmVendorId;
    try {
      crmVendorId = await mapRequired(crm, 'vendors', row.vendor_id);
    } catch {
      skipped += 1;
      writeLog('migration', `032 skip SPO ${row.id}: vendor ${row.vendor_id} not mapped`);
      if (processed % batchSize === 0 || processed === total) progress('spare_parts_po', processed, total);
      continue;
    }

    const poNumber = str(row.purchase_order_number, 64, `SP-PO-ERP-${row.id}`);
    let crmSpoId = await getCrmId(crm, 'spare_parts_po', row.id);
    if (crmSpoId == null) crmSpoId = await findExistingSpoByNumber(crm, poNumber);

    const { rows: vendorRows } = await crm.query(
      `SELECT state FROM vendors WHERE vendor_id = $1 LIMIT 1`,
      [crmVendorId]
    );
    const poState = str(vendorRows[0]?.state, 128, 'NA');

    let lineItems = parseSpareLineItems(row, spareNames, brandNames);
    for (const line of lineItems) {
      if (line.erp_spare_part_id != null) {
        const crmPartId = await getCrmId(crm, 'spare_parts', line.erp_spare_part_id);
        if (crmPartId != null) line.part_id = crmPartId;
      }
    }

    const subTotal = lineSubtotal(lineItems);
    const totalAmount = totalWithGst(subTotal);
    const billFiles = parseBillFiles(row.bill_files);
    const assetsParsed = parseJsonValue(row.assets_details);
    const poDateRaw = str(row.purchase_order_date, 32, '');
    const poDate = poDateRaw ? poDateRaw.slice(0, 10) : new Date().toISOString().slice(0, 10);
    let statusUpdatedBy = null;
    if (row.status_updated_by_id != null) {
      statusUpdatedBy = await getCrmId(crm, 'users', row.status_updated_by_id);
    }

    const payload = [
      poNumber,
      poDate,
      crmVendorId,
      poState,
      true,
      subTotal,
      totalAmount,
      JSON.stringify(lineItems),
      assetsParsed ? JSON.stringify(assetsParsed) : null,
      str(row.remarks, 2000, null),
      mapSpoStatus(row.status),
      statusUpdatedBy,
      str(row.status_updated_by_name, 255, null),
      str(row.bill_name, 255, null),
      JSON.stringify(billFiles),
      row.created_at || new Date(),
      row.updated_at || new Date(),
    ];

    if (crmSpoId) {
      const { rows: snap } = await crm.query(
        `SELECT row_to_json(t) AS j FROM vendor_spare_parts_purchase_orders t WHERE spo_id = $1`,
        [crmSpoId]
      );
      if (snap[0]?.j) {
        await crm.query(
          `INSERT INTO ${BACKUP_TABLE} (spo_id, row_snapshot) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING`,
          [crmSpoId, JSON.stringify(snap[0].j)]
        );
      }
      await crm.query(
        `UPDATE vendor_spare_parts_purchase_orders SET
           purchase_order_number = $2, purchase_order_date = $3, vendor_id = $4, po_state = $5,
           is_same_state = $6, sub_total_amount = $7, total_amount = $8, line_items = $9::jsonb,
           assets_details = $10::jsonb, remarks = $11, status = $12,
           status_updated_by_admin_id = $13, status_updated_by_name = $14,
           bill_name = $15, bill_files = $16::jsonb, updated_at = $17
         WHERE spo_id = $1`,
        [crmSpoId, ...payload.slice(0, -2), payload[payload.length - 1]]
      );
      updated += 1;
    } else {
      const { rows: ins } = await crm.query(
        `INSERT INTO vendor_spare_parts_purchase_orders (
           purchase_order_number, purchase_order_date, vendor_id, po_state, is_same_state,
           sub_total_amount, total_amount, line_items, assets_details, remarks, status,
           status_updated_by_admin_id, status_updated_by_name, bill_name, bill_files,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)
         RETURNING spo_id`,
        payload
      );
      crmSpoId = ins[0].spo_id;
      inserted += 1;
    }

    await setCrmId(crm, {
      entity: 'spare_parts_po',
      erpId: row.id,
      crmId: crmSpoId,
      erpTable: 'spare_parts_po',
      crmTable: 'vendor_spare_parts_purchase_orders',
    });

    if (processed % batchSize === 0 || processed === total) progress('spare_parts_po', processed, total);
  }

  await bumpSpoSequence(crm);
  writeLog('migration', `032 SPO: inserted=${inserted} updated=${updated} skipped=${skipped} erp_total=${total}`);
  return inserted + updated;
}

function extractTtsplCode(raw) {
  const s = str(raw, 255, '');
  if (!s) return null;
  const match = s.match(/TTSPL\d+/i);
  if (match) return match[0].toUpperCase();
  return s.length <= 32 ? s : s.slice(0, 32);
}

async function migratePartsGrns({ erp, crm, batchSize }) {
  let rows;
  try {
    [rows] = await erp.query(
      `SELECT id, grn_number, po_id, product_id, received_qty, created_at, updated_at
         FROM goods_received_notes_parts ORDER BY id`
    );
  } catch {
    writeLog('migration', '032 GRN parts: table not available, skipping');
    return 0;
  }

  let inserted = 0;
  let mapped = 0;
  let skipped = 0;
  let processed = 0;
  const total = rows.length;

  for (const row of rows) {
    processed += 1;
    const existingMap = await getCrmId(crm, 'goods_received_notes_parts', row.id);
    if (existingMap != null) {
      if (processed % batchSize === 0 || processed === total) progress('parts_grn', processed, total);
      continue;
    }

    let crmSpoId;
    try {
      crmSpoId = await mapRequired(crm, 'spare_parts_po', row.po_id);
    } catch {
      skipped += 1;
      if (processed % batchSize === 0 || processed === total) progress('parts_grn', processed, total);
      continue;
    }

    const grnNumber = str(row.grn_number, 64, `SP-GRN-${row.id}`);
    const meta = {
      erp_grn_id: row.id,
      product_id: row.product_id,
      received_qty: row.received_qty,
    };

    const { rows: ins } = await crm.query(
      `INSERT INTO vendor_goods_received_notes (spo_id, bill_status, bill_name, meta, created_at, updated_at)
       VALUES ($1, 'received', $2, $3::jsonb, $4, $5) RETURNING grn_id`,
      [crmSpoId, grnNumber, JSON.stringify(meta), row.created_at || new Date(), row.updated_at || new Date()]
    );

    await setCrmId(crm, {
      entity: 'goods_received_notes_parts',
      erpId: row.id,
      crmId: ins[0].grn_id,
      erpTable: 'goods_received_notes_parts',
      crmTable: 'vendor_goods_received_notes',
    });
    inserted += 1;

    if (processed % batchSize === 0 || processed === total) progress('parts_grn', processed, total);
  }

  await bumpGrnSequence(crm);
  writeLog('migration', `032 parts GRN: inserted=${inserted} mapped=${mapped} skipped=${skipped} total=${total}`);
  return inserted;
}

async function migratePartSerials({ erp, crm, batchSize }) {
  const [rows] = await erp.query(
    `SELECT id, serial_number, unique_product_serial, goods_receipts_id, po_id,
            status, status2, remark, created_at, updated_at
       FROM serial_number_parts ORDER BY id`
  );

  let inserted = 0;
  let mapped = 0;
  let skipped = 0;
  let processed = 0;
  const total = rows.length;

  for (const row of rows) {
    processed += 1;

    const existingMap = await getCrmId(crm, 'serial_number_parts', row.id);
    if (existingMap != null) {
      if (processed % batchSize === 0 || processed === total) progress('part_serials', processed, total);
      continue;
    }

    let crmSpoId;
    let crmGrnId = null;
    try {
      crmSpoId = await mapRequired(crm, 'spare_parts_po', row.po_id);
      if (row.goods_receipts_id != null) {
        crmGrnId = await getCrmId(crm, 'goods_received_notes_parts', row.goods_receipts_id);
      }
    } catch {
      skipped += 1;
      if (processed % batchSize === 0 || processed === total) progress('part_serials', processed, total);
      continue;
    }

    let serialNumber = str(row.serial_number, 255, `SP-PART-${row.id}`);
    let assetCode = extractTtsplCode(row.unique_product_serial);
    const extra = {
      erp_part_serial_id: row.id,
      unique_product_serial: row.unique_product_serial,
      status: row.status,
      status2: row.status2 || undefined,
      part_type: 'spare',
    };

    const { rows: dup } = await crm.query(
      `SELECT serial_id FROM vendor_serial_numbers
        WHERE spo_id = $1 AND LOWER(serial_number) = LOWER($2) AND deleted_at IS NULL LIMIT 1`,
      [crmSpoId, serialNumber]
    );

    let crmSerialId;
    if (dup.length) {
      crmSerialId = dup[0].serial_id;
      mapped += 1;
    } else if (assetCode) {
      const { rows: byCode } = await crm.query(
        `SELECT serial_id, spo_id, po_id FROM vendor_serial_numbers
          WHERE inventory_asset_code = $1 AND deleted_at IS NULL LIMIT 1`,
        [assetCode]
      );
      if (byCode.length && byCode[0].spo_id) {
        crmSerialId = byCode[0].serial_id;
        mapped += 1;
      } else if (byCode.length && !byCode[0].po_id && !byCode[0].spo_id) {
        await crm.query(
          `UPDATE vendor_serial_numbers SET spo_id = $2, extra = extra || $3::jsonb, updated_at = NOW()
           WHERE serial_id = $1`,
          [byCode[0].serial_id, crmSpoId, JSON.stringify(extra)]
        );
        crmSerialId = byCode[0].serial_id;
        mapped += 1;
      }
      // Laptop row already owns this TTSPL — insert spare row without asset code below
    }

    if (!crmSerialId) {
      if (assetCode) {
        const { rows: codeTaken } = await crm.query(
          `SELECT 1 FROM vendor_serial_numbers
            WHERE inventory_asset_code = $1 AND deleted_at IS NULL LIMIT 1`,
          [assetCode]
        );
        if (codeTaken.length) assetCode = null;
      }

      const { rows: snTaken } = await crm.query(
        `SELECT 1 FROM vendor_serial_numbers
          WHERE LOWER(serial_number) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
        [serialNumber]
      );
      if (snTaken.length) {
        serialNumber = `${serialNumber.slice(0, 240)}-sp${row.id}`;
      }

      const { rows: ins } = await crm.query(
        `INSERT INTO vendor_serial_numbers (
           spo_id, grn_id, serial_number, inventory_asset_code,
           qc_status, inventory_status, remark, extra, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING serial_id`,
        [
          crmSpoId,
          crmGrnId,
          serialNumber,
          assetCode,
          str(row.status, 64, 'pending'),
          'in_stock',
          str(row.remark, 5000, null),
          JSON.stringify(extra),
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );
      crmSerialId = ins[0].serial_id;
      inserted += 1;
    }

    await setCrmId(crm, {
      entity: 'serial_number_parts',
      erpId: row.id,
      crmId: crmSerialId,
      erpTable: 'serial_number_parts',
      crmTable: 'vendor_serial_numbers',
    });

    if (processed % batchSize === 0 || processed === total) progress('part_serials', processed, total);
  }

  await bumpSerialSequence(crm);
  writeLog('migration', `032 part serials: inserted=${inserted} mapped=${mapped} skipped=${skipped} total=${total}`);
  return inserted + mapped;
}

async function seedFloorPartsCatalog({ erp, crm, batchSize }) {
  const { rows: partsTable } = await crm.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'parts' LIMIT 1`
  );
  if (!partsTable.length) {
    writeLog('migration', '032 floor parts: `parts` table missing — skip (run migration 088)');
    return 0;
  }

  const { rows: linkCol } = await crm.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vendor_spare_parts_catalog'
        AND column_name = 'floor_part_id' LIMIT 1`
  );
  const canLinkCatalog = linkCol.length > 0;

  const [rows] = await erp.query('SELECT id, name, type, status FROM spare_parts ORDER BY id');
  let inserted = 0;
  let linked = 0;
  let processed = 0;
  const total = rows.length;

  for (const row of rows) {
    processed += 1;
    const partName = str(row.name, 255, `Part ${row.id}`);
    const partType = str(row.type, 64, 'general') || 'general';

    const { rows: existing } = await crm.query(
      canLinkCatalog
        ? `SELECT part_id, floor_part_id FROM vendor_spare_parts_catalog WHERE LOWER(name) = LOWER($1) LIMIT 1`
        : `SELECT part_id FROM vendor_spare_parts_catalog WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [partName]
    );

    let floorPartId = null;
    const { rows: floorDup } = await crm.query(
      `SELECT part_id FROM parts WHERE LOWER(part_name) = LOWER($1) LIMIT 1`,
      [partName]
    );

    if (floorDup.length) {
      floorPartId = floorDup[0].part_id;
    } else {
      const { rows: ins } = await crm.query(
        `INSERT INTO parts (part_name, part_type, quantity, created_at, updated_at)
         VALUES ($1, $2, 0, NOW(), NOW()) RETURNING part_id`,
        [partName, partType]
      );
      floorPartId = ins[0].part_id;
      inserted += 1;
    }

    if (canLinkCatalog && existing.length && existing[0].floor_part_id == null) {
      await crm.query(
        `UPDATE vendor_spare_parts_catalog SET floor_part_id = $2 WHERE part_id = $1`,
        [existing[0].part_id, floorPartId]
      );
      linked += 1;
    }

    if (processed % batchSize === 0 || processed === total) progress('floor_parts', processed, total);
  }

  writeLog('migration', `032 floor parts: inserted=${inserted} linked=${linked} total=${total}`);
  return inserted + linked;
}

module.exports = {
  id: '032',
  name: 'spare_parts_full_resync',
  BACKUP_TABLE,
  async run({ erp, crm, batchSize }) {
    const { spareNames, brandNames } = await loadNameMaps(erp);
    const a = await upsertCatalog({ erp, crm, batchSize });
    const b = await upsertSparePos({ erp, crm, batchSize, spareNames, brandNames });
    const c = await migratePartsGrns({ erp, crm, batchSize });
    const d = await migratePartSerials({ erp, crm, batchSize });
    const e = await seedFloorPartsCatalog({ erp, crm, batchSize });
    return a + b + c + d + e;
  },
};
