#!/usr/bin/env node
/**
 * Fix double/triple-encoded customer_shipping_address so the location renders
 * properly on /sales-pipeline/technician-bucket.
 *
 * Migrated DCs store customer_shipping_address as:
 *   { "name": "<company>", "address": "\"{\\\"name\\\":...,\\\"city\\\":...}\"" }
 * i.e. `address` is a nested JSON STRING holding the real structured address.
 * The page reads addr.address / addr.city / addr.state / addr.pincode / addr.phone,
 * so it prints the raw nested JSON blob.
 *
 * This flattens it (data-only) into the shape the page expects, keeping the
 * company name. Reversible: originals are saved in dc_shipping_address_backup.
 *
 * Scope (default): rows visible on the bucket page
 *   dispatch_mode='inhouse' AND status IN ('in_transit','reached')
 * Pass --all to fix every delivery_challan_lines row with the same defect.
 *
 *   node tools/fix-bucket-shipping-address.js            # apply (bucket rows)
 *   node tools/fix-bucket-shipping-address.js --all      # apply (all rows)
 *   node tools/fix-bucket-shipping-address.js --rollback # undo
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');

const BACKUP_TABLE = 'dc_shipping_address_backup';

const tryParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };

/**
 * Unwrap any depth of (over-)encoded JSON. Handles values that were stringified
 * multiple times, including ones whose stored value begins with an escaped quote
 * (`\"{...}\"`) because an outer JSON-string layer had its quotes stripped.
 */
function deepUnwrap(val) {
  let cur = val;
  for (let i = 0; i < 10 && typeof cur === 'string'; i += 1) {
    let next = tryParse(cur);
    if (next === undefined) next = tryParse(`"${cur}"`); // re-add stripped string quotes
    if (next === undefined || next === cur) break;
    cur = next;
  }
  return cur;
}

const pick = (...vals) => vals.find((v) => v != null && String(v).trim() !== '') ?? null;

/** Build the flat address object the page reads, or null if no change needed. */
function flatten(raw) {
  const outer = deepUnwrap(raw);
  if (!outer || typeof outer !== 'object' || Array.isArray(outer)) return null;

  // The structured address lives in outer.address (nested JSON string) when
  // double-encoded; otherwise outer is already flat.
  const inner = deepUnwrap(outer.address);
  const innerObj = inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : {};

  const hasNested = Object.keys(innerObj).length > 0;
  // Already flat (address is a plain string, city present) -> nothing to do.
  if (!hasNested) return null;

  return {
    name: pick(innerObj.name, outer.name),
    company: pick(outer.name),
    phone: pick(innerObj.phone, outer.phone),
    address: pick(innerObj.address),
    city: pick(innerObj.city),
    state: pick(innerObj.state),
    pincode: pick(innerObj.zip_code, innerObj.pincode, outer.pincode),
    country: pick(innerObj.country),
  };
}

async function ensureBackup(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
      line_id     BIGINT PRIMARY KEY,
      dc_number   TEXT,
      old_value   JSONB,
      new_value   JSONB,
      changed_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function apply(crm, all) {
  await ensureBackup(crm);
  const scope = all
    ? `customer_shipping_address IS NOT NULL`
    : `dispatch_mode='inhouse' AND status IN ('in_transit','reached') AND customer_shipping_address IS NOT NULL`;

  const { rows } = await crm.query(
    `SELECT id, dc_number, customer_shipping_address FROM delivery_challan_lines WHERE ${scope}`,
  );

  let changed = 0;
  await crm.query('BEGIN');
  try {
    for (const row of rows) {
      const flat = flatten(row.customer_shipping_address);
      if (!flat) continue;
      await crm.query(
        `INSERT INTO ${BACKUP_TABLE} (line_id, dc_number, old_value, new_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (line_id) DO NOTHING`,
        [row.id, row.dc_number, row.customer_shipping_address, JSON.stringify(flat)],
      );
      await crm.query(
        `UPDATE delivery_challan_lines SET customer_shipping_address = $2::jsonb, updated_at = NOW()
          WHERE id = $1`,
        [row.id, JSON.stringify(flat)],
      );
      changed += 1;
    }
    await crm.query('COMMIT');
  } catch (e) {
    await crm.query('ROLLBACK');
    throw e;
  }
  console.log(`Scanned   : ${rows.length} line(s) (${all ? 'all' : 'bucket page'})`);
  console.log(`Flattened : ${changed} line(s)`);
}

async function rollback(crm) {
  const exists = await crm.query(`SELECT to_regclass($1) AS t`, [BACKUP_TABLE]);
  if (!exists.rows[0].t) { console.log('No backup table — nothing to roll back.'); return; }
  await crm.query('BEGIN');
  try {
    const upd = await crm.query(
      `UPDATE delivery_challan_lines d
          SET customer_shipping_address = b.old_value, updated_at = NOW()
         FROM ${BACKUP_TABLE} b
        WHERE d.id = b.line_id`,
    );
    await crm.query(`DELETE FROM ${BACKUP_TABLE}`);
    await crm.query('COMMIT');
    console.log(`Reverted  : ${upd.rowCount} line(s)`);
  } catch (e) {
    await crm.query('ROLLBACK');
    throw e;
  }
}

(async () => {
  const crm = getCrmPool();
  try {
    if (process.argv.includes('--rollback')) await rollback(crm);
    else await apply(crm, process.argv.includes('--all'));

    const sample = await crm.query(
      `SELECT dc_number,
              customer_shipping_address->>'address' AS address,
              customer_shipping_address->>'city' AS city,
              customer_shipping_address->>'state' AS state,
              customer_shipping_address->>'pincode' AS pincode
         FROM delivery_challan_lines
        WHERE dispatch_mode='inhouse' AND status IN ('in_transit','reached')
        ORDER BY dc_number LIMIT 3`,
    );
    console.log('\nSample after:');
    for (const r of sample.rows) {
      console.log(` ${r.dc_number}: ${[r.address, r.city, r.state, r.pincode].filter(Boolean).join(', ')}`);
    }
  } finally {
    await closePools();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
