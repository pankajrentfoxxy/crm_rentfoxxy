#!/usr/bin/env node
/**
 * DC/26-27/1039 — customer rejected at delivery but DC was marked delivered by mistake.
 * Backdate rejection + warehouse return on 31 Jul 2026; remove from customer bucket;
 * send TTSPL7398 back to QC Process for re-dispatch to another customer.
 *
 *   node scripts/fix-dc1039-shreyas-delivery-rejection.js           (dry-run)
 *   node scripts/fix-dc1039-shreyas-delivery-rejection.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const rejectionSvc = require('../services/deliveryRejectionService');
const { invalidateInventoryListCachesFireAndForget } = require('../services/inventoryListCache');

const COMMIT = process.argv.includes('--commit');

const DC_NUMBER = 'DC/26-27/1039';
const SO_NUMBER = 'SO/26-27/1051';
const CUSTOMER_ID = 76;
const SERIAL_ID = 8162;
const SERIAL_NUMBER = '5CG0278V2Z';
const TTSPL = 'TTSPL7398';
const SERIAL_TOKEN = `${SERIAL_ID}|${SERIAL_NUMBER}|${TTSPL}`;

// Customer rejected at delivery; laptop returned to warehouse same day (31 Jul 2026 IST).
const REJECTED_AT = '2026-07-31T14:30:00+05:30';
const RETURN_AT = '2026-07-31T19:00:00+05:30';
const REJECTION_REASON = 'Customer rejected at delivery (marked delivered by mistake)';

async function loadState(client) {
  const dc = await client.query(
    `SELECT id, dc_number, sales_order_number, customer_id, customer_name, status,
            serial_number, delivered_serial_numbers, rejected_serial_numbers,
            delivered_at, delivery_completed_at, rejected_at, return_to_warehouse_at
       FROM delivery_challan_lines WHERE dc_number = $1`,
    [DC_NUMBER]
  );
  const vsn = await client.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status,
            current_customer_id, current_dc_number, rent_start_date, rent_billed_until, delivered_at
       FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
    [SERIAL_ID]
  );
  const alloc = await client.query(
    `SELECT allocation_id, status, dc_number, qc_status FROM sales_order_serials
      WHERE serial_id = $1 AND sales_order_number = $2 ORDER BY allocation_id DESC LIMIT 1`,
    [SERIAL_ID, SO_NUMBER]
  );
  return { dc: dc.rows[0], vsn: vsn.rows[0], alloc: alloc.rows[0] };
}

async function main() {
  await rejectionSvc.ensureDeliveryRejectionSchema();
  const client = await pool.connect();
  let state;
  try {
    state = await loadState(client);
  } finally {
    client.release();
  }

  if (!state.dc) throw new Error(`${DC_NUMBER} not found`);
  if (!state.vsn) throw new Error(`${TTSPL} not found`);

  console.log('DC:', state.dc.dc_number, 'status:', state.dc.status);
  console.log('Customer:', state.dc.customer_name, `(#${state.dc.customer_id})`);
  console.log('Serial:', state.vsn.serial_number, state.vsn.inventory_asset_code);
  console.log('  inventory:', state.vsn.inventory_status, 'qc:', state.vsn.qc_status);
  console.log('  customer_id:', state.vsn.current_customer_id, 'dc:', state.vsn.current_dc_number);
  console.log('  rent_start:', state.vsn.rent_start_date, 'billed_until:', state.vsn.rent_billed_until);
  console.log('SO allocation:', state.alloc?.status, state.alloc?.dc_number);
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  if (state.dc.status === 'rejected' && state.dc.return_to_warehouse_at) {
    console.log('Already rejected and returned to warehouse.');
    await pool.end();
    return;
  }

  if (state.dc.status !== 'delivered') {
    throw new Error(`Expected DC status "delivered", got "${state.dc.status}"`);
  }

  if (!COMMIT) {
    console.log('\nWould:');
    console.log(`  1. Mark ${DC_NUMBER} rejected on ${REJECTED_AT.slice(0, 10)}`);
    console.log(`  2. Complete warehouse return on ${RETURN_AT.slice(0, 10)}`);
    console.log(`  3. Move ${TTSPL} rented -> in_stock, qc pending, clear customer`);
    console.log(`  4. Create floor return_qc ticket; release SO allocation for re-dispatch`);
    console.log('Run with --commit to apply.');
    await pool.end();
    return;
  }

  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');

    await tx.query(
      `UPDATE delivery_challan_lines SET
          status = 'rejected',
          rejection_reason = $1,
          rejection_remarks = $2,
          rejection_source = 'customer',
          rejected_at = $3::timestamptz,
          rejected_serial_numbers = $4::jsonb,
          delivered_serial_numbers = NULL,
          delivered_at = NULL,
          delivery_completed_at = NULL,
          d_otp_verified_at = NULL,
          updated_at = NOW()
        WHERE dc_number = $5`,
      [
        REJECTION_REASON,
        'Delivery team marked delivered by mistake; customer refused at doorstep.',
        REJECTED_AT,
        JSON.stringify([SERIAL_TOKEN]),
        DC_NUMBER,
      ]
    );

    const result = await rejectionSvc.completeRejectedReturnToWarehouse(tx, {
      dcNumber: DC_NUMBER,
      actorUserId: null,
      actorName: 'fix-dc1039-shreyas-delivery-rejection',
    });

    await tx.query(
      `UPDATE delivery_challan_lines SET
          return_to_warehouse_at = $1::timestamptz,
          warehouse_return_otp_verified_at = $1::timestamptz,
          rejected_at = $2::timestamptz,
          updated_at = NOW()
        WHERE dc_number = $3`,
      [RETURN_AT, REJECTED_AT, DC_NUMBER]
    );

    // Extra safety: ensure no customer billing anchors remain after mistaken delivery.
    await tx.query(
      `UPDATE vendor_serial_numbers SET
          delivered_at = NULL,
          dispatched_at = NULL,
          rent_start_date = NULL,
          rent_end_date = NULL,
          rent_billed_until = NULL,
          rent_monthly_rate = NULL,
          updated_at = NOW()
        WHERE serial_id = $1`,
      [SERIAL_ID]
    );

    // Customer will not take the order — free the serial for a new SO / customer.
    await tx.query(
      `UPDATE sales_order_serials SET
          status = 'removed',
          dc_number = NULL,
          qc_ticket_id = NULL,
          qc_status = 'pending',
          updated_at = NOW()
        WHERE serial_id = $1 AND sales_order_number = $2 AND status <> 'removed'`,
      [SERIAL_ID, SO_NUMBER]
    );

    await tx.query('COMMIT');

    invalidateInventoryListCachesFireAndForget();

    const after = await loadState(tx);
    console.log('\nDone.');
    console.log('DC status:', after.dc.status, 'rejected_at:', after.dc.rejected_at);
    console.log('return_to_warehouse_at:', after.dc.return_to_warehouse_at);
    console.log('Serial:', {
      inventory_status: after.vsn.inventory_status,
      qc_status: after.vsn.qc_status,
      current_customer_id: after.vsn.current_customer_id,
      current_dc_number: after.vsn.current_dc_number,
      rent_start_date: after.vsn.rent_start_date,
    });
    console.log('SO allocation:', after.alloc);
    console.log('QC tickets:', result.serial_results);
  } catch (e) {
    await tx.query('ROLLBACK');
    throw e;
  } finally {
    tx.release();
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
