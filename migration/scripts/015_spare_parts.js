/**
 * 015 — ERP spare_parts + spare_parts_po → CRM catalog + vendor_spare_parts_purchase_orders
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
} = require('../lib/helpers');

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

function totalWithGst(subtotal, isSameState) {
  const s = Number(subtotal) || 0;
  if (isSameState) return Math.round((s * 1.18) * 100) / 100;
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

async function migrateCatalog({ erp, crm, batchSize }) {
  const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM spare_parts');
  const total = Number(countRows[0].cnt);
  let processed = 0;
  let inserted = 0;

  const [rows] = await erp.query(
    `SELECT id, name, type, status, created_at, updated_at FROM spare_parts ORDER BY id`
  );

  for (const row of rows) {
    processed += 1;
    const existingMap = await getCrmId(crm, 'spare_parts', row.id);
    if (existingMap != null) {
      if (processed % batchSize === 0 || processed === total) progress('spare_parts_catalog', processed, total);
      continue;
    }

    const name = str(row.name, 255, `Part ${row.id}`);
    const active = ['1', 'active', 'approved'].includes(String(row.status).toLowerCase());

    const { rows: dup } = await crm.query(
      `SELECT part_id FROM vendor_spare_parts_catalog WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [name]
    );

    let crmPartId;
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

    if (processed % batchSize === 0 || processed === total) {
      progress('spare_parts_catalog', processed, total);
    }
  }

  writeLog('migration', `015 catalog: inserted=${inserted} total=${total}`);
  return inserted;
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

async function migrateSparePos({ erp, crm, batchSize, spareNames, brandNames }) {
  const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM spare_parts_po');
  const total = Number(countRows[0].cnt);
  let processed = 0;
  let inserted = 0;
  let mapped = 0;
  let skipped = 0;

  const [rows] = await erp.query(
    `SELECT id, purchase_order_number, purchase_order_date, vendor_id, product_details_id,
            assets_details, remarks, status, status_updated_by_id, status_updated_by_name,
            bill_name, bill_files, created_at, updated_at
       FROM spare_parts_po ORDER BY id`
  );

  for (const row of rows) {
    processed += 1;

    const existingMap = await getCrmId(crm, 'spare_parts_po', row.id);
    if (existingMap != null) {
      if (processed % batchSize === 0 || processed === total) progress('spare_parts_po', processed, total);
      continue;
    }

    let crmVendorId;
    try {
      crmVendorId = await mapRequired(crm, 'vendors', row.vendor_id);
    } catch {
      skipped += 1;
      writeLog('migration', `015 skip SPO ${row.id}: vendor ${row.vendor_id} not mapped`);
      if (processed % batchSize === 0 || processed === total) progress('spare_parts_po', processed, total);
      continue;
    }

    const poNumber = str(row.purchase_order_number, 64, `SP-PO-ERP-${row.id}`);
    let crmSpoId = await findExistingSpoByNumber(crm, poNumber);

    const { rows: vendorRows } = await crm.query(
      `SELECT state FROM vendors WHERE vendor_id = $1 LIMIT 1`,
      [crmVendorId]
    );
    const poState = str(vendorRows[0]?.state, 128, 'NA');
    const isSameState = true;

    let lineItems = parseSpareLineItems(row, spareNames, brandNames);
    for (const line of lineItems) {
      if (line.erp_spare_part_id != null) {
        const crmPartId = await getCrmId(crm, 'spare_parts', line.erp_spare_part_id);
        if (crmPartId != null) line.part_id = crmPartId;
      }
    }

    const subTotal = lineSubtotal(lineItems);
    const totalAmount = totalWithGst(subTotal, isSameState);
    const billFiles = parseBillFiles(row.bill_files);
    const assetsParsed = parseJsonValue(row.assets_details);
    const poDateRaw = str(row.purchase_order_date, 32, '');
    const poDate = poDateRaw ? poDateRaw.slice(0, 10) : new Date().toISOString().slice(0, 10);
    let statusUpdatedBy = null;
    if (row.status_updated_by_id != null) {
      statusUpdatedBy = await getCrmId(crm, 'users', row.status_updated_by_id);
    }

    if (crmSpoId) {
      await setCrmId(crm, {
        entity: 'spare_parts_po',
        erpId: row.id,
        crmId: crmSpoId,
        erpTable: 'spare_parts_po',
        crmTable: 'vendor_spare_parts_purchase_orders',
      });
      mapped += 1;
    } else {
      const { rows: ins } = await crm.query(
        `INSERT INTO vendor_spare_parts_purchase_orders (
           purchase_order_number, purchase_order_date, vendor_id, po_state, is_same_state,
           sub_total_amount, total_amount, line_items, assets_details, remarks, status,
           status_updated_by_admin_id, status_updated_by_name, bill_name, bill_files,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16,$17
         ) RETURNING spo_id`,
        [
          poNumber,
          poDate,
          crmVendorId,
          poState,
          isSameState,
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
        ]
      );

      crmSpoId = ins[0].spo_id;
      await setCrmId(crm, {
        entity: 'spare_parts_po',
        erpId: row.id,
        crmId: crmSpoId,
        erpTable: 'spare_parts_po',
        crmTable: 'vendor_spare_parts_purchase_orders',
      });
      inserted += 1;
    }

    if (processed % batchSize === 0 || processed === total) {
      progress('spare_parts_po', processed, total);
    }
  }

  await bumpSpoSequence(crm);
  writeLog(
    'migration',
    `015 SPO: inserted=${inserted} mapped=${mapped} skipped=${skipped} total=${total}`
  );
  return inserted + mapped;
}

module.exports = {
  id: '015',
  name: 'spare_parts',
  async run({ erp, crm, batchSize }) {
    const { spareNames, brandNames } = await loadNameMaps(erp);
    const catalogRows = await migrateCatalog({ erp, crm, batchSize });
    const spoRows = await migrateSparePos({ erp, crm, batchSize, spareNames, brandNames });
    return catalogRows + spoRows;
  },
};
