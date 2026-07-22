/**
 * Remove TTSPL6988 from its current customer and route it to the floor pipeline.
 *
 * Flow (mirrors the standard customer-return path):
 *   1. transitionAsset on_demo -> returned (drops it from the customer's active assets)
 *   2. resetVendorSerialForQcReentry (qc_status -> pending)
 *   3. createTicketFromReturn -> Floor Manager QC re-entry ticket
 *      (on ticket completion the unit flips back to QC-passed + in_stock)
 *
 * Usage:
 *   node scripts/return-ttspl6988-to-floor.js           (dry-run)
 *   node scripts/return-ttspl6988-to-floor.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { transitionAsset } = require('../services/inventoryStateMachine');
const {
  createTicketFromReturn,
  resetVendorSerialForQcReentry,
} = require('../services/grnTicketService');

const TTSPL = 'TTSPL6988';
const COMMIT = process.argv.includes('--commit');

(async () => {
  const r = await pool.query(
    `SELECT s.*, COALESCE(NULLIF(c.company_name,''), c.name) AS customer_name
       FROM vendor_serial_numbers s
       LEFT JOIN customers c ON c.customer_id = s.current_customer_id
      WHERE s.inventory_asset_code = $1 AND s.deleted_at IS NULL`,
    [TTSPL]
  );
  if (!r.rows.length) throw new Error(`${TTSPL} not found`);
  const vsn = r.rows[0];

  console.log(`${TTSPL} — serial ${vsn.serial_number} (serial_id ${vsn.serial_id})`);
  console.log(`  status: ${vsn.inventory_status}, qc: ${vsn.qc_status}`);
  console.log(`  customer: ${vsn.customer_name || '-'} (${vsn.current_customer_id || '-'}), DC: ${vsn.current_dc_number || '-'}`);

  if (!['rented', 'on_demo', 'sold', 'in_transit', 'reserved'].includes(vsn.inventory_status)) {
    console.log(`Nothing to do — unit is not deployed with a customer (status: ${vsn.inventory_status}).`);
    await pool.end();
    return;
  }

  if (!COMMIT) {
    console.log('\nDRY-RUN. Would do:');
    console.log(`  1. transition ${vsn.inventory_status} -> returned (rent_end_date = today)`);
    console.log('  2. reset qc_status -> pending');
    console.log('  3. create Floor Manager QC re-entry ticket');
    console.log('Run with --commit to apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tr = await transitionAsset(client, {
      serialId: vsn.serial_id,
      toStatus: 'returned',
      reason: `Removed from ${vsn.customer_name || 'customer'} — returned to floor for QC re-entry (manual request)`,
      rentEndDate: new Date(),
      actorName: 'Manual return script',
    });
    console.log(`Transition: ${tr.from} -> ${tr.to}`);

    await resetVendorSerialForQcReentry(client, vsn.serial_id);
    console.log('QC status reset to pending');

    const extra = typeof vsn.extra === 'string' ? JSON.parse(vsn.extra || '{}') : (vsn.extra || {});
    const ticket = await createTicketFromReturn(client, {
      serialId: vsn.serial_id,
      serialNumber: vsn.serial_number,
      inventoryAssetCode: vsn.inventory_asset_code,
      customerLabel: vsn.customer_name || null,
      dcNumber: vsn.current_dc_number || null,
      reason: 'Removed from customer per admin request',
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
      console.log(`Floor ticket NOT created: ${ticket.reason}${ticket.ticket_id ? ` (ticket #${ticket.ticket_id})` : ''}${ticket.message ? ` — ${ticket.message}` : ''}`);
    }

    await client.query('COMMIT');
    console.log('\nDone. Unit removed from customer; visible in floor pipeline / returns.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
