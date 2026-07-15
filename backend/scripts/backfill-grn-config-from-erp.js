/**
 * Sync GRN product_details from ERP into CRM vendor_product_details + serial extra.
 * Uses ERP MySQL or erp_rentfoxxy_db.sql (see migration/RUN_MIGRATION.md).
 *
 *   node backend/scripts/backfill-grn-config-from-erp.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../migration/.env') });
require('dotenv').config();

const pool = require('../config/db');
const { createErpSource } = require('../../migration/lib/erpSource');
const { mergeConfigIntoExtra, configFromPlainObject } = require('../services/grnReceivedConfigService');

const BRAND_HINTS = ['Dell', 'HP', 'Lenovo', 'Apple', 'Acer', 'Asus', 'MSI', 'Razer'];

async function loadErpBrandMap(erp) {
  const map = {};
  try {
    const [rows] = await erp.query('SELECT id, name FROM `brands`');
    for (const b of rows) map[String(b.id)] = String(b.name || '').trim();
  } catch {
    /* optional */
  }
  return map;
}

function resolveBrand(raw, brandMap, model) {
  const key = String(raw ?? '').trim();
  if (key && brandMap[key]) return brandMap[key];
  if (key && !/^\d+$/.test(key)) return key;
  const m = String(model || '').toLowerCase();
  for (const hint of BRAND_HINTS) {
    if (m.startsWith(hint.toLowerCase())) return hint;
  }
  return key || '';
}

async function main() {
  const erp = await createErpSource();
  console.log('ERP source:', erp.mode, erp.dumpPath || 'mysql');

  const brandMap = await loadErpBrandMap(erp);

  const { rows: serials } = await pool.query(`
    SELECT serial_id, po_id, serial_number, inventory_asset_code, extra
      FROM vendor_serial_numbers
     WHERE deleted_at IS NULL
       AND po_id IS NOT NULL
       AND NULLIF(extra->>'product_id', '') IS NOT NULL
  `);

  let updatedVpd = 0;
  let updatedSerial = 0;
  let updatedInv = 0;
  let updatedTicket = 0;
  let missingPd = 0;

  for (const s of serials) {
    const productId = Number(s.extra?.product_id);
    if (!Number.isFinite(productId) || productId <= 0) continue;

    const [pdRows] = await erp.query(
      `SELECT id, brand, model, processor, generation, ram, storage, gpu, screen_size
         FROM \`product_details\` WHERE id = ? LIMIT 1`,
      [productId]
    );
    if (!pdRows.length) {
      missingPd += 1;
      continue;
    }
    const pd = pdRows[0];
    const brand = resolveBrand(pd.brand, brandMap, pd.model);
    const config = configFromPlainObject({
      brand,
      model: pd.model,
      processor: pd.processor,
      generation: pd.generation,
      ram: pd.ram,
      storage: pd.storage,
      gpu: pd.gpu,
      screen_size: pd.screen_size
    });
    if (!config) continue;

    const existingVpd = await pool.query(
      `SELECT product_detail_id FROM vendor_product_details WHERE old_product_id = $1 LIMIT 1`,
      [productId]
    );
    if (existingVpd.rows.length) {
      await pool.query(
        `UPDATE vendor_product_details
            SET po_id = COALESCE(po_id, $2),
                brand = CASE WHEN config_locked_at IS NULL THEN $3 ELSE brand END,
                model = CASE WHEN config_locked_at IS NULL THEN $4 ELSE model END,
                processor = CASE WHEN config_locked_at IS NULL THEN $5 ELSE processor END,
                generation = CASE WHEN config_locked_at IS NULL THEN $6 ELSE generation END,
                ram = CASE WHEN config_locked_at IS NULL THEN $7 ELSE ram END,
                storage = CASE WHEN config_locked_at IS NULL THEN $8 ELSE storage END,
                gpu = CASE WHEN config_locked_at IS NULL THEN $9 ELSE gpu END,
                screen_size = CASE WHEN config_locked_at IS NULL THEN $10 ELSE screen_size END,
                updated_at = NOW()
          WHERE old_product_id = $1`,
        [
          productId,
          s.po_id,
          config.brand,
          config.model,
          config.processor,
          config.generation,
          config.ram,
          config.storage,
          config.gpu,
          config.screen_size
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO vendor_product_details (
           po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size,
           quantity, rate, old_product_id
         ) VALUES ($1,'Laptop',$2,$3,$4,$5,$6,$7,$8,$9,1,0,$10)`,
        [
          s.po_id,
          config.brand,
          config.model,
          config.processor,
          config.generation,
          config.ram,
          config.storage,
          config.gpu,
          config.screen_size,
          productId
        ]
      );
      updatedVpd += 1;
    }

    const newExtra = mergeConfigIntoExtra(s.extra, config);
    await pool.query(
      `UPDATE vendor_serial_numbers SET extra = $2::jsonb, updated_at = NOW() WHERE serial_id = $1`,
      [s.serial_id, JSON.stringify(newExtra)]
    );
    updatedSerial += 1;

    const inv = await pool.query(
      `UPDATE inventory
          SET brand = $2, model = $3, processor = $4, generation = $5,
              ram = $6, storage = $7, gpu = $8, screen_size = $9, updated_at = NOW()
        WHERE machine_number = $1 OR LOWER(serial_number) = LOWER($10)
        RETURNING inventory_id`,
      [
        s.inventory_asset_code || '',
        config.brand,
        config.model,
        config.processor,
        config.generation,
        config.ram,
        config.storage,
        config.gpu,
        config.screen_size,
        s.serial_number
      ]
    );
    if (inv.rows.length) updatedInv += inv.rows.length;

    const tkt = await pool.query(
      `UPDATE tickets
          SET brand = $2, model = $3, processor = $4, ram = $5, storage = $6, updated_at = NOW()
        WHERE vendor_serial_id = $1`,
      [s.serial_id, config.brand, config.model, config.processor, config.ram, config.storage]
    );
    updatedTicket += tkt.rowCount || 0;
  }

  await erp.close();

  console.log('Done:', {
    serials: serials.length,
    updatedVpd,
    updatedSerial,
    updatedInv,
    updatedTicket,
    missingPd
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
