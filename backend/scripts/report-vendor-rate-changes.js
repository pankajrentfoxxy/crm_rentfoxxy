#!/usr/bin/env node
/**
 * Read-only report for Accounts: what the per-line vendor rent fix changes.
 *
 * Old rule: every laptop on a PO billed at line 1's "Rate" (then Monthly rental).
 * New rule: each laptop billed at its own line's Monthly rental (then Rate).
 *
 *   node scripts/report-vendor-rate-changes.js            # summary to stdout
 *   node scripts/report-vendor-rate-changes.js --csv out.csv
 *
 * Writes nothing to the database.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const pool = require('../config/db');
const { VENDOR_LINE_JOIN_SQL, VENDOR_LINE_RATE_SQL } = require('../services/billingSchedulerService');

(async () => {
  const csvArg = process.argv.indexOf('--csv');
  const { rows } = await pool.query(
    `SELECT COALESCE(v.business_name, v.first_name, 'Vendor ' || vpo.vendor_id) AS vendor,
            vpo.purchase_order_number AS po,
            vsn.inventory_asset_code AS ttspl,
            COALESCE(NULLIF(vsn.extra->>'line_index', '')::int, 0) + 1 AS line_no,
            COALESCE(NULLIF(NULLIF(vpo.line_items->0->>'rate', '')::numeric, 0),
                     NULLIF(NULLIF(vpo.line_items->0->>'monthly_rental_amount', '')::numeric, 0),
                     NULLIF(NULLIF(vpo.line_items->0->>'monthly_rate', '')::numeric, 0)) AS old_rate,
            ${VENDOR_LINE_RATE_SQL} AS new_rate,
            NULLIF(vln.ln->>'rate', '') AS line_rate_field,
            NULLIF(vln.ln->>'monthly_rental_amount', '') AS line_monthly_field
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
       LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id
       ${VENDOR_LINE_JOIN_SQL}
      WHERE COALESCE(vsn.acquisition_type, vpo.purchase_order_type) IN ('rental_purchase', 'rent_to_own')
        AND vsn.deleted_at IS NULL AND vpo.deleted_at IS NULL
        AND COALESCE(vsn.inventory_status, '') NOT IN ('sold', 'scrapped')
      ORDER BY vendor, po, line_no`
  );

  const flag = (r) => {
    if (r.new_rate == null) return 'NO RATE ON LINE — not billed';
    if (r.line_rate_field && r.line_monthly_field && Number(r.line_rate_field) !== Number(r.line_monthly_field)) return 'Rate and Monthly rent differ — Monthly used';
    if (Number(r.old_rate) !== Number(r.new_rate)) return 'Own line rate differs from line 1';
    return '';
  };
  const changed = rows.filter((r) => flag(r));
  const byVendor = new Map();
  for (const r of rows) {
    const t = byVendor.get(r.vendor) || { laptops: 0, old: 0, new: 0, changed: 0, noRate: 0 };
    t.laptops += 1; t.old += Number(r.old_rate || 0); t.new += Number(r.new_rate || 0);
    if (flag(r)) t.changed += 1;
    if (r.new_rate == null) t.noRate += 1;
    byVendor.set(r.vendor, t);
  }

  const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  console.log(`Rental laptops billed by vendors: ${rows.length}; rate changes for ${changed.length}\n`);
  console.log('Per vendor (monthly rent, full month):');
  for (const [name, t] of [...byVendor.entries()].sort((a, b) => Math.abs(b[1].new - b[1].old) - Math.abs(a[1].new - a[1].old))) {
    if (!t.changed) continue;
    console.log(`  ${name}: ${t.laptops} laptops, ${inr(t.old)} → ${inr(t.new)} (${t.new >= t.old ? '+' : ''}${inr(t.new - t.old)})${t.noRate ? `, ${t.noRate} with no rate` : ''}`);
  }

  if (csvArg > 0 && process.argv[csvArg + 1]) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const out = [['Vendor', 'PO', 'TTSPL', 'PO line', 'Old monthly rent', 'New monthly rent', 'Why'].map(esc).join(',')]
      .concat(changed.map((r) => [r.vendor, r.po, r.ttspl, r.line_no, r.old_rate, r.new_rate, flag(r)].map(esc).join(',')));
    fs.writeFileSync(process.argv[csvArg + 1], `${out.join('\n')}\n`);
    console.log(`\nCSV of ${changed.length} laptops written to ${process.argv[csvArg + 1]}`);
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
