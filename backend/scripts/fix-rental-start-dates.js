#!/usr/bin/env node
/**
 * Vendor rent start for laptops loaded from the ERP (claude/production-promotion-checklist.md).
 *
 * The ERP load of 6-7 Feb 2026 put every old rented laptop on one opening-stock
 * PO per vendor and stamped `rental_start_date = 2027-02-07`. A start date in the
 * future keeps the laptop off every vendor bill. The ERP itself only has the
 * load date (its product rows were created 2026-02-07), so the true first day
 * is not recoverable from either system.
 *
 * What we can prove is the day we certainly had the laptop by: the earliest of
 * the opening-stock PO date, the laptop's first customer rent start, and its
 * first delivery / dispatch. That is the new start. It bills every month from
 * March 2026 on correctly; months before that were settled outside the CRM.
 * The old value is kept in extra.rental_start_date_imported.
 *
 *   node scripts/fix-rental-start-dates.js                 # report
 *   node scripts/fix-rental-start-dates.js --csv out.csv   # report + every laptop
 *   node scripts/fix-rental-start-dates.js --apply         # correct (backup JSON first)
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const IMPORT_ARTEFACT = '2027-02-07';
const apply = process.argv.includes('--apply');
const csvArg = process.argv.indexOf('--csv');

const SELECT_SQL = `
  SELECT vsn.serial_id AS id, vsn.inventory_asset_code AS ttspl, vsn.serial_number,
         COALESCE(v.business_name, 'Vendor ' || vpo.vendor_id) AS vendor,
         vpo.purchase_order_number AS po,
         vsn.inventory_status AS status,
         vsn.rental_start_date::text AS old_start,
         vpo.purchase_order_date::date::text AS po_date,
         vsn.rent_start_date::text AS customer_rent_start,
         (vsn.delivered_at AT TIME ZONE 'Asia/Kolkata')::date::text AS delivered_on,
         (vsn.dispatched_at AT TIME ZONE 'Asia/Kolkata')::date::text AS dispatched_on,
         LEAST(vpo.purchase_order_date::date, vsn.rent_start_date,
               (vsn.delivered_at AT TIME ZONE 'Asia/Kolkata')::date,
               (vsn.dispatched_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS new_start
    FROM vendor_serial_numbers vsn
    JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
    LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id
   WHERE vsn.rental_start_date = $1::date
     AND COALESCE(vsn.acquisition_type, vpo.purchase_order_type) IN ('rental_purchase', 'rent_to_own')
     AND vsn.deleted_at IS NULL
   ORDER BY vendor, vsn.inventory_asset_code`;

function sourceOf(r) {
  if (r.new_start === r.po_date) return 'opening-stock PO date';
  if (r.new_start === r.customer_rent_start) return 'customer rent start';
  if (r.new_start === r.delivered_on) return 'delivered to customer';
  return 'dispatched to customer';
}

(async () => {
  const { rows } = await pool.query(SELECT_SQL, [IMPORT_ARTEFACT]);
  for (const r of rows) r.source = sourceOf(r);

  const other = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
      WHERE vsn.rental_start_date > CURRENT_DATE AND vsn.rental_start_date <> $1::date
        AND COALESCE(vsn.acquisition_type, vpo.purchase_order_type) IN ('rental_purchase', 'rent_to_own')
        AND vsn.deleted_at IS NULL`, [IMPORT_ARTEFACT])).rows[0].n;

  const by = new Map();
  for (const r of rows) {
    const k = `${r.vendor} | ${r.source}`;
    by.set(k, (by.get(k) || 0) + 1);
  }
  console.log(`Rented laptops with rent start ${IMPORT_ARTEFACT}: ${rows.length}`);
  for (const [k, n] of [...by.entries()].sort()) console.log(`  ${k}: ${n}`);
  const earliest = rows.map((r) => r.new_start).sort()[0];
  if (rows.length) console.log(`New starts run from ${earliest} to ${rows.map((r) => r.new_start).sort().pop()}`);
  if (other) console.log(`Other future rent starts (not touched): ${other}`);

  if (csvArg > -1) {
    const cols = ['vendor', 'po', 'ttspl', 'serial_number', 'status', 'old_start', 'new_start', 'source', 'po_date', 'customer_rent_start', 'delivered_on', 'dispatched_on'];
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    fs.writeFileSync(process.argv[csvArg + 1], [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
    console.log(`CSV: ${process.argv[csvArg + 1]}`);
  }

  if (!apply) { console.log('Report only. Add --apply to correct them.'); await pool.end(); return; }

  const dir = path.join(__dirname, '../backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `rental-start-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(rows.map((r) => ({ id: r.id, ttspl: r.ttspl, rental_start_date_before: r.old_start })), null, 2));
  console.log(`Backup: ${backup}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET rental_start_date = $2::date,
                extra = COALESCE(extra, '{}'::jsonb)
                        || jsonb_build_object('rental_start_date_imported', $3::text, 'rental_start_source', $4::text),
                updated_at = NOW()
          WHERE serial_id = $1 AND rental_start_date = $3::date`,
        [r.id, r.new_start, r.old_start, r.source]
      );
    }
    await client.query('COMMIT');
    console.log(`Corrected ${rows.length} laptops.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
