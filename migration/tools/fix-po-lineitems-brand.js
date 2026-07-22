#!/usr/bin/env node
/**
 * Resolve numeric ERP brand ids stored in vendor_purchase_orders.line_items
 * to brand names, mirroring ERP's getBrandDetailsByBrandId() in the GRN /
 * product-received views. Migration persisted product_details.brand (an id,
 * e.g. "1") verbatim, so the GRN view shows "1 Dell Latitude 5310" instead of
 * "Dell Latitude 5310". Data-only; reversible via po_lineitems_brand_backup.
 *
 *   node tools/fix-po-lineitems-brand.js            # apply
 *   node tools/fix-po-lineitems-brand.js --rollback # undo
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');

const BACKUP_TABLE = 'po_lineitems_brand_backup';
const arr = (v) => (Array.isArray(v) ? v
  : (typeof v === 'string' ? (() => { try { return JSON.parse(v || '[]'); } catch { return []; } })() : []));

function brandNameMap() {
  const src = new ErpSqlDumpSource(resolveDumpPath());
  const map = new Map();
  for (const b of src.getTableRows('brands')) {
    const name = b.name ?? b.brand_name ?? b.title;
    if (b.id != null && name) map.set(String(b.id), String(name));
  }
  src.end();
  return map;
}

async function ensureBackup(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
      po_id        BIGINT PRIMARY KEY,
      old_items    JSONB,
      changed_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function apply(crm) {
  await ensureBackup(crm);
  const brands = brandNameMap();
  console.log('ERP brand map size:', brands.size);

  const { rows } = await crm.query(
    `SELECT po_id, line_items FROM vendor_purchase_orders
      WHERE deleted_at IS NULL AND line_items IS NOT NULL`,
  );

  let posChanged = 0; let fieldsChanged = 0; let unresolved = 0;
  await crm.query('BEGIN');
  try {
    for (const r of rows) {
      const items = arr(r.line_items);
      if (!items.length) continue;
      let changed = false;
      const next = items.map((it) => {
        const b = it && it.brand != null ? String(it.brand).trim() : '';
        if (b && /^\d+$/.test(b)) {
          const name = brands.get(b);
          if (name) { fieldsChanged += 1; changed = true; return { ...it, brand: name }; }
          unresolved += 1;
        }
        return it;
      });
      if (!changed) continue;
      await crm.query(
        `INSERT INTO ${BACKUP_TABLE} (po_id, old_items) VALUES ($1, $2)
         ON CONFLICT (po_id) DO NOTHING`,
        [r.po_id, JSON.stringify(items)],
      );
      await crm.query(
        `UPDATE vendor_purchase_orders SET line_items = $2::jsonb, updated_at = NOW()
          WHERE po_id = $1`,
        [r.po_id, JSON.stringify(next)],
      );
      posChanged += 1;
    }
    await crm.query('COMMIT');
  } catch (e) {
    await crm.query('ROLLBACK');
    throw e;
  }
  console.log(`POs updated        : ${posChanged}`);
  console.log(`brand fields fixed : ${fieldsChanged}`);
  console.log(`unresolved ids     : ${unresolved}`);
}

async function rollback(crm) {
  const exists = await crm.query(`SELECT to_regclass($1) AS t`, [BACKUP_TABLE]);
  if (!exists.rows[0].t) { console.log('No backup table — nothing to roll back.'); return; }
  await crm.query('BEGIN');
  try {
    const upd = await crm.query(
      `UPDATE vendor_purchase_orders p
          SET line_items = b.old_items, updated_at = NOW()
         FROM ${BACKUP_TABLE} b
        WHERE p.po_id = b.po_id`,
    );
    await crm.query(`DELETE FROM ${BACKUP_TABLE}`);
    await crm.query('COMMIT');
    console.log(`Reverted: ${upd.rowCount} PO(s)`);
  } catch (e) {
    await crm.query('ROLLBACK');
    throw e;
  }
}

(async () => {
  const crm = getCrmPool();
  try {
    if (process.argv.includes('--rollback')) await rollback(crm);
    else await apply(crm);
  } finally {
    await closePools();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
