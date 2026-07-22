/**
 * Verifies the PREPAID customer billing model end to end:
 *   A) Regenerates the Acme(9)/Globex(10) test invoices under prepaid + catch-up.
 *   B) Full return flow: a customer with 2 units -> prepaid Apr+May -> pick up one
 *      unit mid-May (raises a PENDING credit note for unused days) -> accounts
 *      approves -> June invoice bills the remaining unit and APPLIES the credit note.
 *
 * Uses the REAL engine (billingSchedulerService) and the same inventory/credit
 * helpers the support pickup uses, so a clean run proves the live flow works.
 */
require('dotenv').config();
const pool = require('../config/db');
const billing = require('../services/billingSchedulerService');
const inventorySM = require('../services/inventoryStateMachine');

async function showInvoice(customerId, m, y) {
  const r = await billing.generateCustomerInvoice(customerId, m, y);
  const row = (await pool.query(
    `SELECT invoice_number, from_date, to_date, subtotal, gst_amount,
            credit_note_adjustment, grand_total, line_items
       FROM customer_invoices WHERE customer_id=$1 AND invoice_month=$2 AND invoice_year=$3`,
    [customerId, m, y])).rows[0];
  if (r.skipped && !row) {
    console.log(`  ${m}/${y}: SKIPPED (${r.reason || 'exists'})`);
    return;
  }
  const li = typeof row.line_items === 'string' ? JSON.parse(row.line_items) : row.line_items;
  const catchup = li.filter((l) => l.is_catchup).length;
  console.log(`  ${row.invoice_number} ${m}/${y}  period ${row.from_date?.toISOString?.().slice(0,10) || row.from_date}..${row.to_date?.toISOString?.().slice(0,10) || row.to_date}` +
    `  lines ${li.length}${catchup ? ` (${catchup} catch-up)` : ''}  subtotal ${row.subtotal}  GST ${row.gst_amount}` +
    `  credit ${row.credit_note_adjustment}  grand ${row.grand_total}`);
}

async function resetCustomer(customerId) {
  await pool.query(`DELETE FROM customer_invoices WHERE customer_id=$1`, [customerId]);
  await pool.query(`UPDATE vendor_serial_numbers SET rent_billed_until=NULL WHERE current_customer_id=$1`, [customerId]);
}

// Hard-remove a throwaway test customer + its units (clears inventory audit children
// first to satisfy FKs). Only for the synthetic Part B/C customers.
async function purgeTestCustomer(email) {
  const row = (await pool.query(`SELECT customer_id FROM customers WHERE email=$1`, [email])).rows[0];
  if (!row) return;
  const cid = row.customer_id;
  const ser = (await pool.query(`SELECT serial_id FROM vendor_serial_numbers WHERE current_customer_id=$1`, [cid])).rows;
  const ids = ser.map((s) => s.serial_id);
  if (ids.length) {
    await pool.query(`DELETE FROM ttspl_audit_log WHERE vendor_serial_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM inventory_status_transitions WHERE serial_id = ANY($1::int[])`, [ids]);
  }
  await pool.query(`DELETE FROM customer_credit_notes WHERE customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM customer_invoices WHERE customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM vendor_serial_numbers WHERE current_customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM customers WHERE customer_id=$1`, [cid]);
}

async function partA() {
  console.log('\n===== PART A: prepaid regen for Acme(9) & Globex(10) =====');
  await resetCustomer(9);
  await resetCustomer(10);
  console.log('Customer 9 (Acme, April starts):');
  await showInvoice(9, 4, 2026);
  await showInvoice(9, 5, 2026);
  await showInvoice(9, 6, 2026);
  console.log('Customer 10 (Globex, May starts):');
  await showInvoice(10, 4, 2026);
  await showInvoice(10, 5, 2026);
  await showInvoice(10, 6, 2026);
}

async function partB() {
  console.log('\n===== PART B: return -> credit note -> approve -> applied next invoice =====');
  const EMAIL = 'accounts@initech.test';
  await purgeTestCustomer(EMAIL); // idempotent reset

  const cid = (await pool.query(
    `INSERT INTO customers (name, company_name, email, phone, gst_no, type, billing_state, kyc_verified, kyc_status, status)
     VALUES ('Michael Bolton','Initech Test Pvt Ltd',$1,'9700000001','29AABCI3333C1Z3','B2B','Karnataka',true,'verified',1)
     RETURNING customer_id`, [EMAIL])).rows[0].customer_id;

  const po = (await pool.query(`SELECT po_id FROM vendor_purchase_orders WHERE purchase_order_number='PO-TST-CUST'`)).rows[0].po_id;
  const grn = (await pool.query(`SELECT grn_id FROM vendor_goods_received_notes WHERE po_id=$1 LIMIT 1`, [po])).rows[0].grn_id;

  // allocate two TTSPL codes
  const nn = (await pool.query(`SELECT next_num FROM vendor_inventory_asset_sequence WHERE id=1`)).rows[0].next_num;
  const pad = (n) => 'TTSPL' + String(n).padStart(4, '0');
  async function rentUnit(serial, code, rate) {
    const extra = { brand: 'Dell', model: 'Latitude 5440', ram: '16 GB', storage: '512 GB SSD',
      processor: 'Intel Core i5', generation: '13th Gen', status: 'passed', ttspl_id: code, inventory_tag: 'rental' };
    const r = await pool.query(
      `INSERT INTO vendor_serial_numbers
        (po_id,grn_id,serial_number,inventory_asset_code,qc_status,inventory_status,extra,
         current_customer_id,current_entity,current_dc_number,dispatch_mode,
         dispatched_at,delivered_at,rent_start_date,rent_monthly_rate,status_changed_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'passed','rented',$5::jsonb,$6,'rentfoxxy','DC-TST-IN','courier',
         '2026-04-01 10:00+05:30','2026-04-01 18:00+05:30','2026-04-01',$7,'2026-04-01 18:00+05:30',NOW(),NOW())
       RETURNING serial_id`,
      [po, grn, serial, code, JSON.stringify(extra), cid, rate]);
    return r.rows[0].serial_id;
  }
  const unitX = await rentUnit('IN-X-001', pad(nn), 4000);     // will be returned mid-May
  const unitY = await rentUnit('IN-Y-001', pad(nn + 1), 3000); // stays
  await pool.query(`UPDATE vendor_inventory_asset_sequence SET next_num=$1 WHERE id=1`, [nn + 2]);
  console.log(`Initech customer ${cid}: unit X ${pad(nn)} @4000, unit Y ${pad(nn + 1)} @3000 (both rented 2026-04-01)`);

  console.log('Invoices:');
  await showInvoice(cid, 4, 2026); // Apr advance for both
  await showInvoice(cid, 5, 2026); // May advance for both -> billed_until May31

  // ---- simulate support pickup of unit X on 2026-05-20 (same path as verifyOtp) ----
  const returnDate = new Date('2026-05-20T12:00:00+05:30');
  await inventorySM.markReturned(pool, unitX, { reason: 'Picked up via support (test)', rentEndDate: returnDate, actorUserId: null });
  const cn = await billing.createReturnCreditNote(pool, { serialId: unitX, returnDate, actorUserId: null });
  console.log(`Pickup X on 2026-05-20 -> credit note ${cn?.credit_note_number} amount ${cn?.amount} (status ${cn?.status}) for ${cn?.from_date}..${cn?.to_date}`);

  // ---- accounts approves ----
  await pool.query(`UPDATE customer_credit_notes SET status='approved', updated_at=NOW() WHERE credit_note_id=$1`, [cn.credit_note_id]);
  console.log(`Accounts approved ${cn.credit_note_number}.`);

  // ---- June invoice: unit X returned (no charge), unit Y billed, CN applied ----
  await showInvoice(cid, 6, 2026);
  const after = (await pool.query(`SELECT credit_note_number, status, applied_in_invoice_id FROM customer_credit_notes WHERE credit_note_id=$1`, [cn.credit_note_id])).rows[0];
  console.log(`Credit note now: status=${after.status}, applied_in_invoice_id=${after.applied_in_invoice_id}`);
}

async function partC() {
  console.log('\n===== PART C: mid-month catch-up (unit taken 15-May, first billed on June invoice) =====');
  const EMAIL = 'accounts@wayne.test';
  await purgeTestCustomer(EMAIL); // idempotent reset
  const cid = (await pool.query(
    `INSERT INTO customers (name, company_name, email, phone, gst_no, type, billing_state, kyc_verified, kyc_status, status)
     VALUES ('Bruce Wayne','Wayne Test Pvt Ltd',$1,'9700000002','29AABCW4444D1Z4','B2B','Karnataka',true,'verified',1)
     RETURNING customer_id`, [EMAIL])).rows[0].customer_id;

  const po = (await pool.query(`SELECT po_id FROM vendor_purchase_orders WHERE purchase_order_number='PO-TST-CUST'`)).rows[0].po_id;
  const grn = (await pool.query(`SELECT grn_id FROM vendor_goods_received_notes WHERE po_id=$1 LIMIT 1`, [po])).rows[0].grn_id;
  const nn = (await pool.query(`SELECT next_num FROM vendor_inventory_asset_sequence WHERE id=1`)).rows[0].next_num;
  const code = 'TTSPL' + String(nn).padStart(4, '0');
  const extra = { brand: 'Dell', model: 'Latitude 5440', ram: '16 GB', storage: '512 GB SSD', status: 'passed', ttspl_id: code, inventory_tag: 'rental' };
  await pool.query(
    `INSERT INTO vendor_serial_numbers
      (po_id,grn_id,serial_number,inventory_asset_code,qc_status,inventory_status,extra,
       current_customer_id,current_entity,current_dc_number,dispatch_mode,
       dispatched_at,delivered_at,rent_start_date,rent_monthly_rate,status_changed_at,created_at,updated_at)
     VALUES ($1,$2,'WN-001',$3,'passed','rented',$4::jsonb,$5,'rentfoxxy','DC-TST-WN','courier',
       '2026-05-15 10:00+05:30','2026-05-15 18:00+05:30','2026-05-15',4000,'2026-05-15 18:00+05:30',NOW(),NOW())`,
    [po, grn, code, JSON.stringify(extra), cid]);
  await pool.query(`UPDATE vendor_inventory_asset_sequence SET next_num=$1 WHERE id=1`, [nn + 1]);
  console.log(`Wayne customer ${cid}: unit ${code} @4000 rented 2026-05-15. No May invoice generated.`);

  // Only generate June -> must catch up 15-May..31-May AND advance 01..30-Jun.
  await showInvoice(cid, 6, 2026);
  const inv = (await pool.query(`SELECT line_items FROM customer_invoices WHERE customer_id=$1 AND invoice_month=6`, [cid])).rows[0];
  const li = typeof inv.line_items === 'string' ? JSON.parse(inv.line_items) : inv.line_items;
  li.forEach((l) => console.log(`    ${l.period} ${l.rent_start}..${l.rent_end}  ${l.days_in_month}/${l.month_days}d @${l.daily_rate}/day = ${l.amount}${l.is_catchup ? '  [CATCH-UP]' : ''}`));
}

async function main() {
  await partA();
  await partB();
  await partC();
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
