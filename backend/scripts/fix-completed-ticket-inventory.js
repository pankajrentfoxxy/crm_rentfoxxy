/**
 * Fix vendor serial stuck after QC2 completion (e.g. support pickup re-entry).
 * Usage: node backend/scripts/fix-completed-ticket-inventory.js TTSPL5908
 *        node backend/scripts/fix-completed-ticket-inventory.js --ticket 1426
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const { markVendorSerialReadyForRent } = require('../services/grnTicketService');

async function main() {
  const arg = process.argv[2];
  const ticketArg = process.argv[3];
  if (!arg) {
    console.error('Usage: node fix-completed-ticket-inventory.js TTSPL5908');
    console.error('       node fix-completed-ticket-inventory.js --ticket 1426');
    process.exit(1);
  }

  let ticket;
  if (arg === '--ticket') {
    const r = await pool.query(`SELECT * FROM tickets WHERE ticket_id = $1`, [Number(ticketArg)]);
    ticket = r.rows[0];
  } else {
    const r = await pool.query(
      `SELECT * FROM tickets WHERE ttspl_id = $1 OR machine_number = $1 ORDER BY ticket_id DESC LIMIT 1`,
      [arg]
    );
    ticket = r.rows[0];
  }

  if (!ticket) {
    console.error('Ticket not found');
    process.exit(1);
  }

  const vsn = ticket.vendor_serial_id
    ? (await pool.query(`SELECT serial_id, qc_status, inventory_status, inventory_asset_code FROM vendor_serial_numbers WHERE serial_id = $1`, [ticket.vendor_serial_id])).rows[0]
    : null;

  console.log('Ticket', ticket.ticket_id, ticket.ttspl_id, 'status=', ticket.status);
  if (vsn) {
    console.log('Before:', vsn);
  } else {
    console.log('No vendor_serial_id on ticket');
    process.exit(1);
  }

  if (ticket.status !== 'completed') {
    console.warn('Warning: ticket is not completed — inventory will still be updated');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE inventory SET status = 'In Stock', stock_type = 'Ready', stage = 'Inventory'
       WHERE serial_number = $1 OR machine_number = $2`,
      [ticket.serial_number, ticket.machine_number || ticket.ttspl_id]
    );
    const result = await markVendorSerialReadyForRent(client, ticket, null);
    await client.query('COMMIT');
    const after = (await pool.query(
      `SELECT qc_status, inventory_status FROM vendor_serial_numbers WHERE serial_id = $1`,
      [vsn.serial_id]
    )).rows[0];
    console.log('Result:', result);
    console.log('After:', after);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
