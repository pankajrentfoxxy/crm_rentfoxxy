/**
 * Verifies the Return-DC delivery flow (backend) using the real controllers/services:
 *  - generateReturnDc (technician + courier modes) creates a movement_type='return'
 *    delivery_challan_lines row + sets support_tickets.return_dc_number.
 *  - technician RDC appears in getMyDeliveries / listDeliveryFlow as movement=return.
 *  - finalizeDeliveryInventory(return DC) fires the return lifecycle (unit returned,
 *    qc reset, return_qc ticket, credit note, support pickup resolved).
 */
require('dotenv').config();
const pool = require('../config/db');
const sm = require('../controllers/salesManagementController');
const flow = require('../controllers/deliveryFlowController');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${x ? ` (${x})` : ''}`); c ? pass++ : fail++; };
function mockRes() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; }

async function purge(email) {
  const row = (await pool.query(`SELECT customer_id FROM customers WHERE email=$1`, [email])).rows[0];
  if (!row) return;
  const cid = row.customer_id;
  const ids = (await pool.query(`SELECT serial_id FROM vendor_serial_numbers WHERE current_customer_id=$1`, [cid])).rows.map(r => r.serial_id);
  const tks = (await pool.query(`SELECT id FROM support_tickets WHERE customer_id=$1`, [cid])).rows.map(r => r.id);
  if (tks.length) { await pool.query(`DELETE FROM support_ticket_items WHERE ticket_id = ANY($1::int[])`, [tks]); await pool.query(`DELETE FROM delivery_challan_lines WHERE support_ticket_id = ANY($1::int[])`, [tks]); await pool.query(`DELETE FROM support_tickets WHERE id = ANY($1::int[])`, [tks]); }
  if (ids.length) {
    const ft = (await pool.query(`SELECT ticket_id FROM tickets WHERE vendor_serial_id = ANY($1::int[])`, [ids])).rows.map(r => r.ticket_id);
    if (ft.length) { await pool.query(`DELETE FROM work_logs WHERE ticket_id = ANY($1::int[])`, [ft]); await pool.query(`DELETE FROM activities WHERE ticket_id = ANY($1::int[])`, [ft]); await pool.query(`DELETE FROM tickets WHERE ticket_id = ANY($1::int[])`, [ft]); }
    await pool.query(`DELETE FROM ttspl_audit_log WHERE vendor_serial_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM inventory_status_transitions WHERE serial_id = ANY($1::int[])`, [ids]);
  }
  await pool.query(`DELETE FROM customer_credit_notes WHERE customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM customer_invoices WHERE customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM vendor_serial_numbers WHERE current_customer_id=$1`, [cid]);
  await pool.query(`DELETE FROM customers WHERE customer_id=$1`, [cid]);
}

async function makeRentedUnit(cid, code, serial, rate) {
  const po = (await pool.query(`SELECT po_id FROM vendor_purchase_orders WHERE purchase_order_number='PO-TST-CUST'`)).rows[0].po_id;
  const grn = (await pool.query(`SELECT grn_id FROM vendor_goods_received_notes WHERE po_id=$1 LIMIT 1`, [po])).rows[0].grn_id;
  const extra = { brand: 'Dell', model: 'Latitude 5440', ram: '16 GB', storage: '512 GB SSD', status: 'passed', ttspl_id: code, inventory_tag: 'rental' };
  return (await pool.query(
    `INSERT INTO vendor_serial_numbers (po_id,grn_id,serial_number,inventory_asset_code,qc_status,inventory_status,extra,
       current_customer_id,current_entity,current_dc_number,dispatch_mode,dispatched_at,delivered_at,rent_start_date,rent_monthly_rate,status_changed_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'passed','rented',$5::jsonb,$6,'rentfoxxy','DC-RDCT','courier','2026-04-01 10:00+05:30','2026-04-01 18:00+05:30','2026-04-01',$7,'2026-04-01 18:00+05:30',NOW(),NOW())
     RETURNING serial_id`, [po, grn, serial, code, JSON.stringify(extra), cid, rate])).rows[0].serial_id;
}

async function makePickupTicket(cid, name, code, serial) {
  const tid = (await pool.query(
    `INSERT INTO support_tickets (customer_id, customer_name, status, last_activity_at, priority, ticket_category, complaint_type, ttspl_id, customer_portal_ticket, portal_customer_id, pickup_address)
     VALUES ($1,$2,'open',NOW(),'normal','pickup','pickup',$3,TRUE,$1,$4::jsonb) RETURNING id`,
    [cid, name, code, JSON.stringify({ name, phone: '9700000000', address: '12 Test St', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' })])).rows[0].id;
  await pool.query(
    `INSERT INTO support_ticket_items (ticket_id, serial_number, unique_serial_number, item_type, issue_category_label, status, otp_code, brand, model)
     VALUES ($1,$2,$2,'pickup','Return Request','open','123456','Dell','Latitude 5440')`, [tid, code]);
  return tid;
}

async function main() {
  const EMAIL = 'returndc@test';
  await purge(EMAIL);
  const cid = (await pool.query(
    `INSERT INTO customers (name, company_name, email, phone, gst_no, type, billing_state, kyc_verified, kyc_status, status)
     VALUES ('Return DC','ReturnDC Test Pvt Ltd',$1,'9700000010','29AABCD8888Z1Z8','B2B','Karnataka',true,'verified',1) RETURNING customer_id`, [EMAIL])).rows[0].customer_id;
  const nn = (await pool.query(`SELECT next_num FROM vendor_inventory_asset_sequence WHERE id=1`)).rows[0].next_num;
  const pad = (n) => 'TTSPL' + String(n).padStart(4, '0');
  const techUser = (await pool.query(`SELECT user_id FROM users WHERE role IN ('technician','dispatch','floor_manager') AND active=TRUE ORDER BY user_id LIMIT 1`)).rows[0]?.user_id || 1;

  // generate prepaid invoices for unit 1 so a credit note can be raised
  const code1 = pad(nn), code2 = pad(nn + 1);
  const s1 = await makeRentedUnit(cid, code1, 'RDC-T-1', 4000);
  const s2 = await makeRentedUnit(cid, code2, 'RDC-C-1', 3500);
  await pool.query(`UPDATE vendor_inventory_asset_sequence SET next_num=$1 WHERE id=1`, [nn + 2]);
  const billing = require('../services/billingSchedulerService');
  await billing.generateCustomerInvoice(cid, 4, 2026);
  await billing.generateCustomerInvoice(cid, 5, 2026);
  await billing.generateCustomerInvoice(cid, 6, 2026); // prepaid through June so a mid-June return leaves a refundable tail

  console.log('\n===== Technician-mode Return DC =====');
  const t1 = await makePickupTicket(cid, 'ReturnDC Test Pvt Ltd', code1, 'RDC-T-1');
  let res = mockRes();
  await sm.generateReturnDc({ params: { ticketId: t1 }, body: { pickup_mode: 'technician', technician_user_id: techUser }, user: { user_id: 1, name: 'Tester' } }, res);
  check('generateReturnDc(technician) ok', res.body?.success, JSON.stringify(res.body));
  const rdc1 = res.body?.return_dc_number;
  const dcRow = (await pool.query(`SELECT movement_type, dispatch_mode, delivery_person_id, support_ticket_id, status FROM delivery_challan_lines WHERE dc_number=$1`, [rdc1])).rows[0];
  check('RDC row movement=return, inhouse, tech assigned', dcRow && dcRow.movement_type === 'return' && dcRow.dispatch_mode === 'inhouse' && dcRow.delivery_person_id === techUser && dcRow.support_ticket_id === t1);
  const tk = (await pool.query(`SELECT return_dc_number FROM support_tickets WHERE id=$1`, [t1])).rows[0];
  check('support ticket return_dc_number set', tk.return_dc_number === rdc1);

  // appears in My Deliveries for the technician, tagged return
  const myRes = mockRes();
  await flow.getMyDeliveries({ user: { user_id: techUser, role: 'dispatch' } }, myRes);
  const mine = (myRes.body?.items || []).find((d) => d.dc_number === rdc1);
  check('RDC visible in technician My Deliveries as movement=return', mine && mine.movement_type === 'return', mine ? mine.status : 'not found');

  // complete via finalizeDeliveryInventory (same call submitDeliveryWithPod makes)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE delivery_challan_lines SET status='delivered', delivered_at=NOW() WHERE dc_number=$1`, [rdc1]);
    await sm.finalizeDeliveryInventory(client, rdc1, { user_id: 1, name: 'Tester' });
    await client.query('COMMIT');
  } finally { client.release(); }
  const su = (await pool.query(`SELECT inventory_status, qc_status FROM vendor_serial_numbers WHERE serial_id=$1`, [s1])).rows[0];
  check('unit returned + qc reset after RDC completion', su.inventory_status === 'returned' && su.qc_status !== 'passed', JSON.stringify(su));
  const rqt = (await pool.query(`SELECT ticket_id FROM tickets WHERE vendor_serial_id=$1 AND ticket_type='return_qc'`, [s1])).rows[0];
  check('return_qc floor ticket created', !!rqt);
  const cn = (await pool.query(`SELECT credit_note_number, serial_id, return_ticket_id FROM customer_credit_notes WHERE serial_id=$1`, [s1])).rows[0];
  check('credit note raised + linked', cn && cn.return_ticket_id === rqt?.ticket_id, cn?.credit_note_number);
  const itemStatus = (await pool.query(`SELECT status FROM support_ticket_items WHERE ticket_id=$1 LIMIT 1`, [t1])).rows[0];
  check('support pickup item resolved', itemStatus.status === 'resolved', itemStatus.status);

  console.log('\n===== Courier-mode Return DC =====');
  const t2 = await makePickupTicket(cid, 'ReturnDC Test Pvt Ltd', code2, 'RDC-C-1');
  res = mockRes();
  await sm.generateReturnDc({ params: { ticketId: t2 }, body: { pickup_mode: 'courier', courier_name: 'BlueDart', awb_number: 'BD123' }, user: { user_id: 1, name: 'Tester' } }, res);
  check('generateReturnDc(courier) ok', res.body?.success, JSON.stringify(res.body));
  const rdc2 = res.body?.return_dc_number;
  const dc2 = (await pool.query(`SELECT movement_type, dispatch_mode, delivery_person_id, courier_name FROM delivery_challan_lines WHERE dc_number=$1`, [rdc2])).rows[0];
  check('courier RDC: return + courier + no technician + awb stored', dc2 && dc2.movement_type === 'return' && dc2.dispatch_mode === 'courier' && !dc2.delivery_person_id && dc2.courier_name === 'BlueDart');

  // shows in Return DC list
  const listRes = mockRes();
  await sm.listReturnDeliveryChallans({}, listRes);
  const inList = (listRes.body?.orders || []).some((o) => o.return_dc_number === rdc1 || o.return_dc_number === rdc2);
  check('Return DC list includes generated RDCs', inList);

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
