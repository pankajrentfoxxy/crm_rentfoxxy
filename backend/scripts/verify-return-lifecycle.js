/**
 * End-to-end verification of the return lifecycle (uses the REAL service code
 * the support pickup + floor Force-Fail call):
 *  A) Customer return: prepaid Apr+May -> pickup 20-May -> assert QC re-entry
 *     (qc_status reset, return_qc floor ticket, CN linked) -> complete ticket
 *     -> assert unit back to passed/in_stock.
 *  B) Vendor return: a Force-Fail ticket -> auto DRAFT debit note linked +
 *     unit visible in vendor returns (floor UNION).
 */
require('dotenv').config();
const pool = require('../config/db');
const billing = require('../services/billingSchedulerService');
const inventorySM = require('../services/inventoryStateMachine');
const { createTicketFromReturn, applyGrnVendorQcPassOnTicketComplete } = require('../services/grnTicketService');
const vendorBilling = require('../controllers/vendorBillingController');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`); cond ? pass++ : fail++; };

async function purge(email) {
  const row = (await pool.query(`SELECT customer_id FROM customers WHERE email=$1`, [email])).rows[0];
  if (!row) return;
  const cid = row.customer_id;
  const ids = (await pool.query(`SELECT serial_id FROM vendor_serial_numbers WHERE current_customer_id=$1`, [cid])).rows.map(r => r.serial_id);
  if (ids.length) {
    const tids = (await pool.query(`SELECT ticket_id FROM tickets WHERE vendor_serial_id = ANY($1::int[])`, [ids])).rows.map(r => r.ticket_id);
    if (tids.length) {
      await pool.query(`DELETE FROM work_logs WHERE ticket_id = ANY($1::int[])`, [tids]);
      await pool.query(`DELETE FROM activities WHERE ticket_id = ANY($1::int[])`, [tids]);
      await pool.query(`DELETE FROM tickets WHERE ticket_id = ANY($1::int[])`, [tids]);
    }
    await pool.query(`DELETE FROM ttspl_audit_log WHERE vendor_serial_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM inventory_status_transitions WHERE serial_id = ANY($1::int[])`, [ids]);
  }
  await pool.query(`DELETE FROM customer_credit_notes WHERE customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM customer_invoices WHERE customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM vendor_serial_numbers WHERE current_customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM customers WHERE customer_id=$1`, [cid]);
}

async function partA() {
  console.log('\n===== A) Customer return lifecycle =====');
  const EMAIL = 'returnlc@test';
  await purge(EMAIL);
  const cid = (await pool.query(
    `INSERT INTO customers (name, company_name, email, phone, gst_no, type, billing_state, kyc_verified, kyc_status, status)
     VALUES ('Return LC','ReturnLC Test Pvt Ltd',$1,'9700000009','29AABCR9999Z1Z9','B2B','Karnataka',true,'verified',1)
     RETURNING customer_id`, [EMAIL])).rows[0].customer_id;
  const po = (await pool.query(`SELECT po_id FROM vendor_purchase_orders WHERE purchase_order_number='PO-TST-CUST'`)).rows[0].po_id;
  const grn = (await pool.query(`SELECT grn_id FROM vendor_goods_received_notes WHERE po_id=$1 LIMIT 1`, [po])).rows[0].grn_id;
  const nn = (await pool.query(`SELECT next_num FROM vendor_inventory_asset_sequence WHERE id=1`)).rows[0].next_num;
  const code = 'TTSPL' + String(nn).padStart(4, '0');
  const extra = { brand: 'Dell', model: 'Latitude 5440', ram: '16 GB', storage: '512 GB SSD', status: 'passed', ttspl_id: code, inventory_tag: 'rental' };
  const serialId = (await pool.query(
    `INSERT INTO vendor_serial_numbers (po_id,grn_id,serial_number,inventory_asset_code,qc_status,inventory_status,extra,
       current_customer_id,current_entity,current_dc_number,dispatch_mode,dispatched_at,delivered_at,rent_start_date,rent_monthly_rate,status_changed_at,created_at,updated_at)
     VALUES ($1,$2,'RLC-001',$3,'passed','rented',$4::jsonb,$5,'rentfoxxy','DC-RLC','courier','2026-04-01 10:00+05:30','2026-04-01 18:00+05:30','2026-04-01',4000,'2026-04-01 18:00+05:30',NOW(),NOW())
     RETURNING serial_id`, [po, grn, code, JSON.stringify(extra), cid])).rows[0].serial_id;
  await pool.query(`UPDATE vendor_inventory_asset_sequence SET next_num=$1 WHERE id=1`, [nn + 1]);

  await billing.generateCustomerInvoice(cid, 4, 2026);
  await billing.generateCustomerInvoice(cid, 5, 2026);

  // --- simulate the support pickup path (mirror of verifyOtp) ---
  const returnDate = new Date('2026-05-20T12:00:00+05:30');
  await inventorySM.markReturned(pool, serialId, { reason: 'Picked up (test)', rentEndDate: returnDate, actorUserId: null });
  await pool.query(`UPDATE vendor_serial_numbers SET qc_status='pending', updated_at=NOW() WHERE serial_id=$1`, [serialId]);
  const tk = await createTicketFromReturn(pool, {
    serialId, serialNumber: 'RLC-001', inventoryAssetCode: code, customerLabel: 'ReturnLC Test Pvt Ltd',
    dcNumber: 'DC-RLC', reason: 'Customer return', specs: extra, actorUserId: null,
  });
  const cn = await billing.createReturnCreditNote(pool, { serialId, returnDate, returnTicketId: tk.ticket_id, actorUserId: null });

  // --- assertions ---
  const su = (await pool.query(`SELECT inventory_status, qc_status FROM vendor_serial_numbers WHERE serial_id=$1`, [serialId])).rows[0];
  check('unit inventory_status = returned', su.inventory_status === 'returned', su.inventory_status);
  check('unit qc_status reset (not passed) -> shows in QC Process', su.qc_status !== 'passed', su.qc_status);
  const tkt = (await pool.query(`SELECT t.ticket_type, t.status, s.stage_name FROM tickets t JOIN stages s ON s.stage_id=t.current_stage_id WHERE t.ticket_id=$1`, [tk.ticket_id])).rows[0];
  check('return_qc floor ticket created', tk.ok && tkt.ticket_type === 'return_qc', `ticket ${tk.ticket_id}, stage ${tkt?.stage_name}`);
  check('credit note linked to serial + return ticket', cn && cn.serial_id === serialId && cn.return_ticket_id === tk.ticket_id, `${cn?.credit_note_number} amt ${cn?.amount}`);

  // appears in QC Process count?
  const qcCount = (await pool.query(
    `SELECT COUNT(*)::int c FROM vendor_serial_numbers s JOIN vendor_purchase_orders p ON p.po_id=s.po_id
      WHERE s.serial_id=$1 AND COALESCE(NULLIF(TRIM(s.qc_status),''), NULLIF(TRIM(s.extra->>'status'),''),'pending') <> 'passed'`,
    [serialId])).rows[0].c;
  check('unit counted in QC Process segment', qcCount === 1);

  // complete the return ticket -> back to passed/in_stock (same path GRN uses)
  const ticketRow = (await pool.query(`SELECT * FROM tickets WHERE ticket_id=$1`, [tk.ticket_id])).rows[0];
  const done = await applyGrnVendorQcPassOnTicketComplete(pool, ticketRow, null);
  const su2 = (await pool.query(`SELECT inventory_status, qc_status FROM vendor_serial_numbers WHERE serial_id=$1`, [serialId])).rows[0];
  check('on ticket completion -> qc passed + in_stock (ready to rent)', su2.qc_status === 'passed' && su2.inventory_status === 'in_stock', `${JSON.stringify(su2)} applied=${done.applied}`);
}

async function partB() {
  console.log('\n===== B) Vendor return -> draft debit note + visibility =====');
  // fresh vendor-2 rental unit on PO-TST-VAPR
  const po = (await pool.query(`SELECT po_id FROM vendor_purchase_orders WHERE purchase_order_number='PO-TST-VAPR'`)).rows[0].po_id;
  const grn = (await pool.query(`SELECT grn_id FROM vendor_goods_received_notes WHERE po_id=$1 LIMIT 1`, [po])).rows[0].grn_id;
  // clean prior run
  const prev = (await pool.query(`SELECT serial_id FROM vendor_serial_numbers WHERE serial_number='VRET-001'`)).rows[0];
  if (prev) {
    await pool.query(`DELETE FROM vendor_debit_notes WHERE serial_id=$1`, [prev.serial_id]);
    await pool.query(`DELETE FROM tickets WHERE vendor_serial_id=$1`, [prev.serial_id]);
    await pool.query(`DELETE FROM ttspl_audit_log WHERE vendor_serial_id=$1`, [prev.serial_id]);
    await pool.query(`DELETE FROM inventory_status_transitions WHERE serial_id=$1`, [prev.serial_id]);
    await pool.query(`DELETE FROM vendor_serial_numbers WHERE serial_id=$1`, [prev.serial_id]);
  }
  const nn = (await pool.query(`SELECT next_num FROM vendor_inventory_asset_sequence WHERE id=1`)).rows[0].next_num;
  const code = 'TTSPL' + String(nn).padStart(4, '0');
  const serialId = (await pool.query(
    `INSERT INTO vendor_serial_numbers (po_id,grn_id,serial_number,inventory_asset_code,qc_status,inventory_status,extra,created_at,updated_at)
     VALUES ($1,$2,'VRET-001',$3,'pending','in_stock',$4::jsonb,NOW(),NOW()) RETURNING serial_id`,
    [po, grn, code, JSON.stringify({ brand: 'HP', model: 'EliteBook 840 G8', ttspl_id: code })])).rows[0].serial_id;
  await pool.query(`UPDATE vendor_inventory_asset_sequence SET next_num=$1 WHERE id=1`, [nn + 1]);

  // a floor ticket Force-Failed to vendor
  const ticketId = (await pool.query(
    `INSERT INTO tickets (serial_number, ttspl_id, machine_number, initial_condition, priority, ticket_type,
       current_stage_id, status, vendor_serial_id, floor_manager_qc_failed, floor_manager_qc_failed_at, floor_manager_qc_fail_reason)
     VALUES ('VRET-001',$1,$1,'Force fail test','high','return_qc',(SELECT stage_id FROM stages ORDER BY stage_order LIMIT 1),
             'qc_failed_return_vendor',$2,TRUE,NOW(),'Dead motherboard') RETURNING ticket_id`,
    [code, serialId])).rows[0].ticket_id;
  const ticket = (await pool.query(`SELECT * FROM tickets WHERE ticket_id=$1`, [ticketId])).rows[0];

  const dn = await vendorBilling.createReturnDebitNote(pool, { ticket, reason: 'Dead motherboard', actorUserId: null });
  check('draft debit note auto-created', !!dn, dn?.debit_note_number);
  check('debit note linked to serial + return ticket + status pending', dn && dn.serial_id === serialId && dn.return_ticket_id === ticketId && dn.status === 'pending', `amount ${dn?.amount}`);
  check('debit note amount starts at 0 (editable)', dn && Number(dn.amount) === 0);

  // idempotent: second call returns null
  const dn2 = await vendorBilling.createReturnDebitNote(pool, { ticket, reason: 'Dead motherboard', actorUserId: null });
  check('idempotent (no duplicate debit note)', dn2 === null);

  // floor return visible to vendor (UNION query used by listVendorReturns)
  const vendorId = (await pool.query(`SELECT vendor_id FROM vendor_purchase_orders WHERE po_id=$1`, [po])).rows[0].vendor_id;
  const vis = (await pool.query(
    `SELECT t.ticket_id, dn.debit_note_number FROM tickets t
       JOIN vendor_serial_numbers vsn ON vsn.serial_id=t.vendor_serial_id AND vsn.deleted_at IS NULL
       JOIN vendor_purchase_orders vpo ON vpo.po_id=vsn.po_id AND vpo.vendor_id=$1
       LEFT JOIN vendor_debit_notes dn ON dn.return_ticket_id=t.ticket_id
      WHERE t.status='qc_failed_return_vendor' AND t.ticket_id=$2`, [vendorId, ticketId])).rows[0];
  check('floor return visible to vendor with linked debit note', vis && vis.debit_note_number === dn.debit_note_number);
}

async function main() {
  await partA();
  await partB();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
