/**
 * Seeds a customer with a PENDING return credit note, ready to approve in the UI:
 *   Stark Test Pvt Ltd: 2 units rented 01-Apr -> prepaid Apr + May invoices ->
 *   unit X picked up 20-May (raises a PENDING credit note). Approval + June
 *   invoice are left for you to do in the UI so you can watch the full flow.
 */
require('dotenv').config();
const pool = require('../config/db');
const billing = require('../services/billingSchedulerService');
const inventorySM = require('../services/inventoryStateMachine');

async function purge(email) {
  const row = (await pool.query(`SELECT customer_id FROM customers WHERE email=$1`, [email])).rows[0];
  if (!row) return;
  const cid = row.customer_id;
  const ids = (await pool.query(`SELECT serial_id FROM vendor_serial_numbers WHERE current_customer_id=$1`, [cid])).rows.map(r => r.serial_id);
  if (ids.length) {
    await pool.query(`DELETE FROM ttspl_audit_log WHERE vendor_serial_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM inventory_status_transitions WHERE serial_id = ANY($1::int[])`, [ids]);
  }
  await pool.query(`DELETE FROM customer_credit_notes WHERE customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM customer_invoices WHERE customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM vendor_serial_numbers WHERE current_customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM customers WHERE customer_id=$1`, [cid]);
}

async function main() {
  const EMAIL = 'accounts@stark.test';
  await purge(EMAIL);

  const cid = (await pool.query(
    `INSERT INTO customers (name, company_name, email, phone, gst_no, type, billing_state, kyc_verified, kyc_status, status)
     VALUES ('Tony Stark','Stark Test Pvt Ltd',$1,'9700000003','29AABCS5555E1Z5','B2B','Karnataka',true,'verified',1)
     RETURNING customer_id`, [EMAIL])).rows[0].customer_id;

  const po = (await pool.query(`SELECT po_id FROM vendor_purchase_orders WHERE purchase_order_number='PO-TST-CUST'`)).rows[0].po_id;
  const grn = (await pool.query(`SELECT grn_id FROM vendor_goods_received_notes WHERE po_id=$1 LIMIT 1`, [po])).rows[0].grn_id;
  const nn = (await pool.query(`SELECT next_num FROM vendor_inventory_asset_sequence WHERE id=1`)).rows[0].next_num;
  const pad = (n) => 'TTSPL' + String(n).padStart(4, '0');
  async function rent(serial, code, rate) {
    const extra = { brand: 'Dell', model: 'Latitude 5440', ram: '16 GB', storage: '512 GB SSD', status: 'passed', ttspl_id: code, inventory_tag: 'rental' };
    return (await pool.query(
      `INSERT INTO vendor_serial_numbers (po_id,grn_id,serial_number,inventory_asset_code,qc_status,inventory_status,extra,
         current_customer_id,current_entity,current_dc_number,dispatch_mode,dispatched_at,delivered_at,rent_start_date,rent_monthly_rate,status_changed_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'passed','rented',$5::jsonb,$6,'rentfoxxy','DC-TST-ST','courier','2026-04-01 10:00+05:30','2026-04-01 18:00+05:30','2026-04-01',$7,'2026-04-01 18:00+05:30',NOW(),NOW())
       RETURNING serial_id`, [po, grn, serial, code, JSON.stringify(extra), cid, rate])).rows[0].serial_id;
  }
  const unitX = await rent('ST-X-001', pad(nn), 4500);
  await rent('ST-Y-001', pad(nn + 1), 3000);
  await pool.query(`UPDATE vendor_inventory_asset_sequence SET next_num=$1 WHERE id=1`, [nn + 2]);

  await billing.generateCustomerInvoice(cid, 4, 2026); // April prepaid
  await billing.generateCustomerInvoice(cid, 5, 2026); // May prepaid -> billed_until May31

  const returnDate = new Date('2026-05-20T12:00:00+05:30');
  await inventorySM.markReturned(pool, unitX, { reason: 'Picked up via support (demo pending CN)', rentEndDate: returnDate, actorUserId: null });
  const cn = await billing.createReturnCreditNote(pool, { serialId: unitX, returnDate, actorUserId: null });

  console.log('Seeded pending credit-note demo:');
  console.log(`  Customer:    Stark Test Pvt Ltd (id ${cid})`);
  console.log(`  Returned:    ${pad(nn)} (SN ST-X-001) on 20-May; still holding ${pad(nn + 1)} (SN ST-Y-001)`);
  console.log(`  Credit note: ${cn.credit_note_number}  Rs ${cn.amount}  status ${cn.status}  (${cn.from_date}..${cn.to_date})`);
  console.log('  Now in UI: Finance > Credit Notes > Approve ' + cn.credit_note_number + ', then generate Stark JUNE 2026 invoice to see it applied.');
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
