#!/usr/bin/env node
/**
 * Idempotent backfill: rebuild PO line_items and serial extra config from ERP product_details.
 *
 * ERP stores one product_details row per laptop; PO product_details_id lists those ids in order.
 * Migrated POs often have a single aggregated assets_details line — this script replaces
 * line_items with per-unit rows and writes each serial's hardware config into extra.
 *
 * Usage (from repo root or migration/):
 *   node migration/tools/backfill-grn-config-from-erp.js
 *   node migration/tools/backfill-grn-config-from-erp.js --dry-run
 *   node migration/tools/backfill-grn-config-from-erp.js --po-id 9
 *   ERP_SQL_DUMP_PATH=/path/to/erp_rentfoxxy_db.sql node migration/tools/backfill-grn-config-from-erp.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createErpSource } = require('../lib/erpSource');
const { getCrmPool, closePools } = require('../lib/db');
const {
  buildBrandMapFromRows,
  buildSerialConfigExtra,
  indexProductDetailsRows,
  parseLegacyProductIds,
  resolvePoLineItems,
} = require('../lib/erpProductConfig');

const dryRun = process.argv.includes('--dry-run');
const poFilter = (() => {
  const idx = process.argv.indexOf('--po-id');
  if (idx >= 0 && process.argv[idx + 1]) return Number(process.argv[idx + 1]);
  return null;
})();

function stableJson(obj) {
  const normalize = (value) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        const v = normalize(value[key]);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(normalize(obj));
}

async function loadErpCatalog(erp) {
  let brandRows;
  let pdRows;
  if (erp.getTableRows) {
    brandRows = erp.getTableRows('brands');
    pdRows = erp.getTableRows('product_details');
  } else {
    [brandRows] = await erp.query('SELECT id, name FROM `brands`');
    [pdRows] = await erp.query(
      `SELECT id, brand, model, processor, generation, ram, storage, gpu, screen_size,
              quantity, rate, vendor_locking_period, warranty, remarks
         FROM \`product_details\``
    );
  }
  const brandMap = buildBrandMapFromRows(brandRows);
  const productDetailsById = indexProductDetailsRows(pdRows);
  return { brandMap, productDetailsById };
}

async function loadErpPurchaseOrders(erp) {
  if (erp.getTableRows) return erp.getTableRows('purchase_orders');
  const [rows] = await erp.query(
    `SELECT id, assets_details, product_details_id FROM \`purchase_orders\` ORDER BY id`
  );
  return rows;
}

async function loadErpSerialRows(erp, erpPoId) {
  if (erp.getTableRows) {
    return erp.getTableRows('serial_numbers').filter((r) => String(r.po_id) === String(erpPoId));
  }
  const [rows] = await erp.query(
    `SELECT id, serial_number, unique_product_serial, product_id, goods_receipts_id, po_id,
            rental_period, product_warranty, dataoldSerialNumber, status, status2,
            action_status, came_from, action_remark, remark, is_replaced, is_repaired,
            require_parts, require_parts_done, file_path, seller_id, vendor_name,
            hardware_action, hardware_remark, hardware_action_by, hardware_action_date,
            created_at, updated_at
       FROM \`serial_numbers\`
      WHERE po_id = ?`,
    [erpPoId]
  );
  return rows;
}

function buildSerialExtraFromErpRow(row) {
  const extra = {
    unique_product_serial: row.unique_product_serial,
    product_id: row.product_id != null ? String(row.product_id) : undefined,
    erp_serial_id: row.id,
  };
  return Object.fromEntries(
    Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}

async function backfillPurchaseOrders(crm, erpPos, productDetailsById, brandMap) {
  const mapRes = await crm.query(
    `SELECT erp_id, crm_id FROM erp_id_map WHERE entity = 'purchase_orders'`
  );
  const crmByErp = new Map(mapRes.rows.map((r) => [String(r.erp_id), Number(r.crm_id)]));

  let checked = 0;
  let updated = 0;
  let skipped = 0;

  for (const erpPo of erpPos) {
    if (poFilter != null && Number(erpPo.id) !== poFilter) continue;
    const crmPoId = crmByErp.get(String(erpPo.id));
    if (!crmPoId) {
      skipped += 1;
      continue;
    }

    checked += 1;
    const legacyIds = parseLegacyProductIds(erpPo.product_details_id);
    const lineItems = resolvePoLineItems({
      assetsRaw: erpPo.assets_details,
      legacyIdsRaw: erpPo.product_details_id,
      productDetailsById,
      brandMap,
    });

    if (!lineItems.length) {
      skipped += 1;
      continue;
    }

    const { rows: cur } = await crm.query(
      `SELECT line_items FROM vendor_purchase_orders
        WHERE po_id = $1 AND deleted_at IS NULL`,
      [crmPoId]
    );
    if (!cur.length) {
      skipped += 1;
      continue;
    }

    const current = cur[0].line_items;
    if (stableJson(current) === stableJson(lineItems)) continue;

    if (dryRun) {
      console.log(`[dry-run] PO erp=${erpPo.id} crm=${crmPoId}: line_items ${Array.isArray(current) ? current.length : 0} -> ${lineItems.length}`);
      updated += 1;
      continue;
    }

    await crm.query(
      `UPDATE vendor_purchase_orders
          SET line_items = $2::jsonb,
              product_details_legacy_ids = $3::jsonb,
              updated_at = NOW()
        WHERE po_id = $1`,
      [crmPoId, JSON.stringify(lineItems), JSON.stringify(legacyIds)]
    );
    updated += 1;
  }

  return { checked, updated, skipped };
}

async function backfillSerials(crm, erpPos, productDetailsById, brandMap, erp) {
  const mapRes = await crm.query(
    `SELECT erp_id, crm_id FROM erp_id_map WHERE entity = 'serial_numbers'`
  );
  const crmSerialByErp = new Map(mapRes.rows.map((r) => [String(r.erp_id), Number(r.crm_id)]));

  let checked = 0;
  let updated = 0;
  let skipped = 0;

  for (const erpPo of erpPos) {
    if (poFilter != null && Number(erpPo.id) !== poFilter) continue;
    const legacyIds = parseLegacyProductIds(erpPo.product_details_id);
    if (!legacyIds.length) continue;

    const erpSerials = await loadErpSerialRows(erp, erpPo.id);
    for (const erpSerial of erpSerials) {
      const crmSerialId = crmSerialByErp.get(String(erpSerial.id));
      if (!crmSerialId) {
        skipped += 1;
        continue;
      }

      checked += 1;
      const { rows: cur } = await crm.query(
        `SELECT extra FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
        [crmSerialId]
      );
      if (!cur.length) {
        skipped += 1;
        continue;
      }

      const oldExtra =
        cur[0].extra && typeof cur[0].extra === 'object' && !Array.isArray(cur[0].extra)
          ? cur[0].extra
          : {};

      const nextExtra = buildSerialConfigExtra({
        serialRow: erpSerial,
        legacyIds,
        productDetailsById,
        brandMap,
        baseExtra: { ...oldExtra, ...buildSerialExtraFromErpRow(erpSerial) },
      });

      if (stableJson(oldExtra) === stableJson(nextExtra)) continue;

      if (dryRun) {
        console.log(
          `[dry-run] serial erp=${erpSerial.id} crm=${crmSerialId} product_id=${erpSerial.product_id} line_index=${nextExtra.line_index}`
        );
        updated += 1;
        continue;
      }

      await crm.query(
        `UPDATE vendor_serial_numbers
            SET extra = $2::jsonb, updated_at = NOW()
          WHERE serial_id = $1`,
        [crmSerialId, JSON.stringify(nextExtra)]
      );
      updated += 1;
    }
  }

  return { checked, updated, skipped };
}

(async () => {
  const erp = await createErpSource();
  const crm = getCrmPool();
  try {
    console.log(`ERP source: ${erp.mode || 'mysql'}${erp.dumpPath ? ` (${erp.dumpPath})` : ''}`);
    if (dryRun) console.log('Dry run — no CRM writes.');

    const { brandMap, productDetailsById } = await loadErpCatalog(erp);
    const erpPos = await loadErpPurchaseOrders(erp);
    console.log(`Loaded ${erpPos.length} ERP PO(s), ${productDetailsById.size} product_details row(s).`);

    const poStats = await backfillPurchaseOrders(crm, erpPos, productDetailsById, brandMap);
    console.log(`PO line_items: checked=${poStats.checked} updated=${poStats.updated} skipped=${poStats.skipped}`);

    const serialStats = await backfillSerials(crm, erpPos, productDetailsById, brandMap, erp);
    console.log(
      `Serial extra config: checked=${serialStats.checked} updated=${serialStats.updated} skipped=${serialStats.skipped}`
    );
  } finally {
    if (erp.close) await erp.close();
    await closePools();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
