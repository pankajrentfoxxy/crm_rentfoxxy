/**
 * Verifies the support ticket-creation flow now reads live tables:
 *  - searchCustomers returns real customers
 *  - getCustomerAssets returns the customer's deployed laptops (vendor_serial_numbers)
 *  - createTicket (complaint) succeeds with a vendor-serial-based item
 *  - addWorkflowPhaseItems can add a pickup phase after the complaint resolves
 */
require('dotenv').config();
const pool = require('../config/db');
const support = require('../controllers/supportController');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${x ? ` (${x})` : ''}`); c ? pass++ : fail++; };
function mockRes() { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; }
const USER = { user_id: 2, role: 'admin', name: 'Admin' };

async function main() {
  // find a customer that currently has a deployed (rented) laptop
  const row = (await pool.query(
    `SELECT current_customer_id AS cid FROM vendor_serial_numbers
      WHERE current_customer_id IS NOT NULL AND deleted_at IS NULL AND inventory_status='rented'
      LIMIT 1`)).rows[0];
  if (!row) { console.log('No rented serial found to test with'); process.exit(1); }
  const cid = row.cid;

  // searchCustomers
  let res = mockRes();
  await support.searchCustomers({ query: { search: '' }, user: USER }, res);
  check('searchCustomers returns customers', (res.body?.items || []).length > 0, `${res.body?.items?.length} found`);

  // getCustomerAssets
  res = mockRes();
  await support.getCustomerAssets({ params: { customerId: cid }, user: USER }, res);
  const assets = res.body?.assets || [];
  check('getCustomerAssets returns deployed laptops', assets.length > 0, `${assets.length} for customer ${cid}`);
  const a = assets[0];
  check('asset has TTSPL + serial', !!a && !!a.unique_serial_number, a ? `${a.unique_serial_number} / ${a.serial_number}` : '');

  // createTicket (complaint) using that asset
  res = mockRes();
  await support.createTicket({
    body: {
      customer_id: cid,
      customer_name: 'Test',
      ticket_category: 'complaint',
      priority: 'normal',
      ticket_address: 'Test addr',
      items: [{
        customer_inventory_id: null,
        serial_number: a.serial_number,
        unique_serial_number: a.unique_serial_number,
        model: a.model_name,
        brand: (a.model_name || '').split(' ')[0],
        ram: a.ram, storage: a.storage, generation: a.generation,
        item_type: 'complaint',
        remarks: 'Screen flickering — support test',
      }],
    },
    user: USER,
  }, res);
  check('createTicket(complaint) succeeded', res.statusCode === 201 && res.body?.success, JSON.stringify(res.body?.message || res.body?.ticket?.id));
  const ticketId = res.body?.ticket?.id;
  const itemId = res.body?.items?.[0]?.id;

  // resolve the complaint item, then add a pickup phase for the same machine
  if (ticketId && itemId) {
    await pool.query(`UPDATE support_ticket_items SET status='resolved', outcome='fixed' WHERE id=$1`, [itemId]);
    res = mockRes();
    await support.addWorkflowPhaseItems({
      params: { ticketId },
      body: { items: [{ item_type: 'pickup', source_item_id: itemId, serial_number: a.serial_number, unique_serial_number: a.unique_serial_number, model: a.model_name }] },
      user: USER,
    }, res);
    check('addWorkflowPhaseItems(pickup) succeeded', res.body?.success === true, JSON.stringify(res.body?.message || 'ok'));
  }

  // cleanup the test ticket
  if (ticketId) {
    await pool.query(`DELETE FROM support_ticket_item_comments WHERE item_id IN (SELECT id FROM support_ticket_items WHERE ticket_id=$1)`, [ticketId]).catch(() => {});
    await pool.query(`DELETE FROM support_ticket_items WHERE ticket_id=$1`, [ticketId]);
    await pool.query(`DELETE FROM support_tickets WHERE id=$1`, [ticketId]);
    console.log(`  (cleaned up test ticket ${ticketId})`);
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
