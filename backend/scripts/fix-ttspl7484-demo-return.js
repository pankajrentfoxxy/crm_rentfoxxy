/**
 * TTSPL7484 — correct demo + return timeline:
 *   DC/26-27/0970  dispatched & delivered 2026-07-25 (not 2026-08-03)
 *   RDC001865      pickup 2026-07-31
 *   Current state  on floor (returned from demo customer 961)
 *
 * Usage:
 *   node scripts/fix-ttspl7484-demo-return.js           (dry-run)
 *   node scripts/fix-ttspl7484-demo-return.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { transitionAsset } = require('../services/inventoryStateMachine');
const {
  createTicketFromReturn,
  resetVendorSerialForQcReentry,
} = require('../services/grnTicketService');

const TTSPL = 'TTSPL7484';
const SERIAL_ID = 8248;
const DEMO_ID = 13;
const PICKUP_TICKET_ID = 2618;
const PICKUP_ITEM_ID = 2783;
const OUTBOUND_DC = 'DC/26-27/0970';
const RETURN_DC = 'RDC001865';
const CUSTOMER_ID = 961;

const DEMO_DELIVERED = '2026-07-25T08:11:20.000Z';
const RETURN_DATE = '2026-07-31T10:35:11.236Z';
const DECISION_DUE = '2026-08-01T08:11:20.000Z';

const COMMIT = process.argv.includes('--commit');

(async () => {
  const r = await pool.query(
    `SELECT s.*, COALESCE(NULLIF(c.company_name,''), c.name) AS customer_name
       FROM vendor_serial_numbers s
       LEFT JOIN customers c ON c.customer_id = s.current_customer_id
      WHERE s.serial_id = $1 AND s.deleted_at IS NULL`,
    [SERIAL_ID]
  );
  if (!r.rows.length) throw new Error(`${TTSPL} not found`);
  const vsn = r.rows[0];

  const inv = await pool.query(
    'SELECT inventory_id, status, stage FROM inventory WHERE machine_number = $1',
    [TTSPL]
  );
  const demo = await pool.query('SELECT * FROM demo_agreements WHERE demo_id = $1', [DEMO_ID]);
  const dcs = await pool.query(
    `SELECT dc_number, status, movement_type, dispatched_at, delivered_at, delivery_completed_at
       FROM delivery_challan_lines
      WHERE dc_number IN ($1, $2)`,
    [OUTBOUND_DC, RETURN_DC]
  );

  console.log('Current state:');
  console.log(`  vsn: ${vsn.inventory_status}, customer=${vsn.current_customer_id}, dc=${vsn.current_dc_number}`);
  console.log(`  delivered_at=${vsn.delivered_at}, returned_at=${vsn.returned_at}`);
  console.log(`  inventory: ${inv.rows[0]?.status || '-'} / ${inv.rows[0]?.stage || '-'}`);
  console.log(`  demo: decision=${demo.rows[0]?.decision}, delivered_at=${demo.rows[0]?.delivered_at}`);
  for (const dc of dcs.rows) {
    console.log(`  ${dc.dc_number}: dispatched=${dc.dispatched_at}, delivered=${dc.delivered_at}`);
  }

  console.log('\nTarget:');
  console.log(`  Demo delivered ${DEMO_DELIVERED}, return ${RETURN_DATE}, on floor (returned + QC re-entry)`);

  if (!COMMIT) {
    console.log('\nDRY-RUN. Run with --commit to apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Outbound demo DC — correct delivery date to 25 Jul
    await client.query(
      `UPDATE delivery_challan_lines
          SET dispatched_at = $1,
              delivered_at = $1,
              delivery_completed_at = $1,
              updated_at = NOW()
        WHERE dc_number = $2`,
      [DEMO_DELIVERED, OUTBOUND_DC]
    );

    // 2. Return DC — pickup completed 31 Jul
    await client.query(
      `UPDATE delivery_challan_lines
          SET delivered_at = $1,
              delivery_completed_at = $1,
              updated_at = NOW()
        WHERE dc_number = $2`,
      [RETURN_DATE, RETURN_DC]
    );

    // 3. Demo agreement — delivered 25 Jul, decided return on 31 Jul
    await client.query(
      `UPDATE demo_agreements
          SET delivered_at = $1,
              decision_due_at = $2,
              decision = 'return',
              decided_at = $3,
              pickup_ticket_id = $4,
              updated_at = NOW()
        WHERE demo_id = $5`,
      [DEMO_DELIVERED, DECISION_DUE, RETURN_DATE, PICKUP_TICKET_ID, DEMO_ID]
    );

    // 4. Pickup item + support ticket dates
    await client.query(
      `UPDATE support_ticket_items
          SET warehouse_received_at = $1, updated_at = NOW()
        WHERE id = $2`,
      [RETURN_DATE, PICKUP_ITEM_ID]
    );
    await client.query(
      `UPDATE support_tickets
          SET closed_at = $1, last_activity_at = $1, updated_at = NOW()
        WHERE id = $2`,
      [RETURN_DATE, PICKUP_TICKET_ID]
    );

    // 5. Correct outbound delivery timestamps before marking returned
    await client.query(
      `UPDATE vendor_serial_numbers
          SET dispatched_at = $1,
              delivered_at = $1,
              updated_at = NOW()
        WHERE serial_id = $2`,
      [DEMO_DELIVERED, SERIAL_ID]
    );

    // 6. on_demo -> returned (remove from customer active assets)
    const tr = await transitionAsset(client, {
      serialId: SERIAL_ID,
      toStatus: 'returned',
      reason: `Demo return via ${RETURN_DC} (pickup 31 Jul 2026)`,
      rentEndDate: RETURN_DATE.slice(0, 10),
      actorName: 'Data repair: TTSPL7484 demo return',
    });
    console.log(`Transition: ${tr.from} -> ${tr.to}`);

    await client.query(
      `UPDATE vendor_serial_numbers
          SET returned_at = $1,
              rent_end_date = $2::date,
              current_customer_id = NULL,
              current_dc_number = NULL,
              dispatched_at = $3,
              delivered_at = $3,
              updated_at = NOW()
        WHERE serial_id = $4`,
      [RETURN_DATE, RETURN_DATE.slice(0, 10), DEMO_DELIVERED, SERIAL_ID]
    );

    await resetVendorSerialForQcReentry(client, SERIAL_ID);

    await client.query(
      `UPDATE inventory SET status = 'Floor', stage = 'Floor Manager', updated_at = NOW()
        WHERE machine_number = $1`,
      [TTSPL]
    );

    const extra = typeof vsn.extra === 'string' ? JSON.parse(vsn.extra || '{}') : (vsn.extra || {});
    const ticket = await createTicketFromReturn(client, {
      serialId: SERIAL_ID,
      serialNumber: vsn.serial_number,
      inventoryAssetCode: vsn.inventory_asset_code,
      customerLabel: vsn.customer_name || 'Ship Global',
      dcNumber: RETURN_DC,
      reason: 'Demo return — picked up 31 Jul 2026',
      specs: {
        brand: extra.brand,
        model: extra.model || extra.model_name,
        processor: extra.processor,
        ram: extra.ram,
        storage: extra.storage || extra.ssd,
      },
      actorUserId: null,
    });
    if (ticket.ok) {
      console.log(`Floor ticket created: #${ticket.ticket_id}`);
    } else {
      console.log(`Floor ticket: ${ticket.reason}${ticket.ticket_id ? ` (#${ticket.ticket_id})` : ''}`);
    }

    await client.query('COMMIT');
    console.log('\nDone.');

    const verify = await pool.query(
      `SELECT inventory_status, current_customer_id, current_dc_number,
              delivered_at, dispatched_at, returned_at, qc_status
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    const invAfter = await pool.query(
      'SELECT status, stage FROM inventory WHERE machine_number = $1',
      [TTSPL]
    );
    const demoAfter = await pool.query(
      'SELECT decision, delivered_at, decided_at, pickup_ticket_id FROM demo_agreements WHERE demo_id = $1',
      [DEMO_ID]
    );
    console.log('After:', JSON.stringify({
      vsn: verify.rows[0],
      inventory: invAfter.rows[0],
      demo: demoAfter.rows[0],
    }, null, 2));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
