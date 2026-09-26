#!/usr/bin/env node
/**
 * Purchase orders (laptop and spare-part) whose GST type is wrong: stored as
 * IGST where CGST+SGST was due, or the other way round. The rule the PO forms
 * use since 26 Sep 2026: the vendor's state is the one in its GSTIN (else its
 * stored state), compared with the PO's delivery state, all as one canonical
 * state ("HR" = "Haryana" = "haryana").
 *
 * The total does not change — IGST 18% and CGST 9% + SGST 9% are the same
 * amount — only the split printed on the PO. What Accounts must look at is the
 * vendor INVOICE on a completed PO: if the vendor charged the wrong type, the
 * input tax credit is at risk; that list is in the CSV (has_vendor_invoice).
 *
 *   node scripts/fix-po-gst-type.js                     report only
 *   node scripts/fix-po-gst-type.js --csv out.csv       report + CSV for Accounts
 *   node scripts/fix-po-gst-type.js --apply             correct them (backup JSON first)
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { vendorGstState, canonicalState } = require('../utils/indianStateCodes');
const { getTotalAmountOfPurchaseOrder } = require('../utils/purchaseOrderGst');

const TABLES = [
  { table: 'vendor_purchase_orders', kind: 'laptop', key: 'po_id', number: 'purchase_order_number', invoice: 'vendor_invoice_number' },
  { table: 'vendor_spare_parts_purchase_orders', kind: 'spare', key: null, number: null, invoice: null },
];

const typeOf = (same) => (same ? 'CGST+SGST' : 'IGST');

async function spareColumns() {
  const cols = (await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'vendor_spare_parts_purchase_orders'`
  )).rows.map((r) => r.column_name);
  return {
    key: cols.includes('spo_id') ? 'spo_id' : (cols.includes('id') ? 'id' : cols[0]),
    number: ['spare_po_number', 'purchase_order_number', 'po_number'].find((c) => cols.includes(c)) || null,
    invoice: ['vendor_invoice_number'].find((c) => cols.includes(c)) || null,
  };
}

async function findMismatches() {
  const out = [];
  for (const t of TABLES) {
    const meta = t.kind === 'spare' ? { ...t, ...(await spareColumns()) } : t;
    const { rows } = await pool.query(
      `SELECT po.*, v.business_name AS vendor_name, v.state AS vendor_state, v.gst_number AS vendor_gstin
         FROM ${meta.table} po
         LEFT JOIN vendors v ON v.vendor_id = po.vendor_id
        WHERE po.deleted_at IS NULL`
    );
    for (const r of rows) {
      const vState = vendorGstState({ state: r.vendor_state, gst_number: r.vendor_gstin });
      const poState = canonicalState(r.po_state);
      if (!vState || !poState) continue;
      const due = vState === poState;
      if (due === Boolean(r.is_same_state)) continue;
      const sub = Number(r.sub_total_amount) || 0;
      out.push({
        table: meta.table,
        kind: meta.kind,
        key_col: meta.key,
        id: r[meta.key],
        po_number: meta.number ? r[meta.number] : `#${r[meta.key]}`,
        vendor: r.vendor_name || `Vendor ${r.vendor_id}`,
        vendor_gstin: r.vendor_gstin || '',
        vendor_state: vState,
        po_state: poState,
        status: r.status,
        stored_type: typeOf(r.is_same_state),
        correct_type: typeOf(due),
        correct_same_state: due,
        sub_total: sub,
        total_stored: Number(r.total_amount) || 0,
        total_correct: getTotalAmountOfPurchaseOrder(sub, due),
        gst_amount: Math.round(sub * 18) / 100,
        has_vendor_invoice: Boolean(meta.invoice && r[meta.invoice]),
        vendor_invoice_number: meta.invoice ? (r[meta.invoice] || '') : '',
        date: r.purchase_order_date || r.created_at,
      });
    }
  }
  return out;
}

function toCsv(rows) {
  const cols = ['kind', 'po_number', 'vendor', 'vendor_gstin', 'vendor_state', 'po_state', 'status', 'stored_type', 'correct_type',
    'sub_total', 'gst_amount', 'total_stored', 'total_correct', 'has_vendor_invoice', 'vendor_invoice_number', 'date'];
  const esc = (v) => {
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

(async () => {
  const apply = process.argv.includes('--apply');
  const csvAt = process.argv.indexOf('--csv');
  const rows = await findMismatches();

  const groups = {};
  for (const r of rows) {
    const k = `${r.kind} ${r.stored_type} → ${r.correct_type} (${['completed', 'cancelled', 'closed'].includes(r.status) ? 'done' : 'open'})`;
    groups[k] = (groups[k] || 0) + 1;
  }
  console.log(`POs with the wrong GST type: ${rows.length}`);
  for (const [k, n] of Object.entries(groups)) console.log(`  ${k}: ${n}`);
  const invoiced = rows.filter((r) => r.has_vendor_invoice);
  console.log(`  of which a vendor invoice is on file (Accounts: check the tax type the vendor charged): ${invoiced.length}`);
  const drift = rows.filter((r) => Math.abs(r.total_stored - r.total_correct) > 0.01);
  console.log(`  totals that would change: ${drift.length} (the GST amount is 18% either way)`);

  if (csvAt > -1 && process.argv[csvAt + 1]) {
    fs.writeFileSync(process.argv[csvAt + 1], toCsv(rows));
    console.log(`CSV written: ${process.argv[csvAt + 1]}`);
  }
  if (!apply) { console.log('Report only. Add --apply to correct them.'); await pool.end(); return; }

  const dir = path.join(__dirname, '../backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `po-gst-type-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(rows.map((r) => ({
    table: r.table, key_col: r.key_col, id: r.id, po_number: r.po_number,
    is_same_state_before: r.stored_type === 'CGST+SGST', total_before: r.total_stored,
  })), null, 2));
  console.log(`Backup: ${backup}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `UPDATE ${r.table} SET is_same_state = $2, total_amount = $3, updated_at = NOW() WHERE ${r.key_col} = $1`,
        [r.id, r.correct_same_state, r.total_correct]
      );
      if (r.kind === 'laptop') {
        await client.query(
          `INSERT INTO vendor_audit_logs (actor_user_id, vendor_id, entity_type, entity_id, action, payload)
           SELECT NULL, vendor_id, 'purchase_order', $1::text, 'gst_type_corrected', $2::jsonb
             FROM vendor_purchase_orders WHERE po_id = $3`,
          [String(r.id), JSON.stringify({ from: r.stored_type, to: r.correct_type, vendor_state: r.vendor_state, po_state: r.po_state }), r.id]
        );
      }
    }
    await client.query('COMMIT');
    console.log(`Corrected ${rows.length} POs.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
