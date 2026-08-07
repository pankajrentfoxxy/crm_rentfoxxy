/**
 * Smoke test for support serial eligibility rules.
 * Run: node scripts/verify-support-serial-eligibility.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const {
  checkSerialEligibleForSupportTicket,
  SUPPORT_TICKET_ELIGIBLE_STATUSES,
} = require('../services/supportSerialEligibility');

(async () => {
  console.log('Eligible statuses:', SUPPORT_TICKET_ELIGIBLE_STATUSES.join(', '));

  const inTransit = await pool.query(
    `SELECT vsn.inventory_asset_code, vsn.inventory_status, vsn.current_customer_id, vsn.delivered_at
       FROM vendor_serial_numbers vsn
      WHERE vsn.inventory_status = 'in_transit'
        AND vsn.current_customer_id IS NOT NULL
        AND vsn.deleted_at IS NULL
      LIMIT 3`
  );

  for (const row of inTransit.rows) {
    const client = await pool.connect();
    try {
      const result = await checkSerialEligibleForSupportTicket(client, row.current_customer_id, {
        ttspl_id: row.inventory_asset_code,
      }, { ticketCategory: 'pickup' });
      console.log(row.inventory_asset_code, '->', result.ok ? 'ALLOWED (bad)' : `BLOCKED: ${result.message}`);
    } finally {
      client.release();
    }
  }

  const delivered = await pool.query(
    `SELECT vsn.inventory_asset_code, vsn.inventory_status, vsn.current_customer_id, vsn.delivered_at
       FROM vendor_serial_numbers vsn
      WHERE vsn.inventory_status IN ('rented','on_demo')
        AND vsn.current_customer_id IS NOT NULL
        AND vsn.delivered_at IS NOT NULL
        AND vsn.deleted_at IS NULL
      LIMIT 2`
  );

  for (const row of delivered.rows) {
    const client = await pool.connect();
    try {
      const result = await checkSerialEligibleForSupportTicket(client, row.current_customer_id, {
        ttspl_id: row.inventory_asset_code,
      }, { ticketCategory: 'complaint' });
      console.log(row.inventory_asset_code, '->', result.ok ? 'ALLOWED (ok)' : `BLOCKED: ${result.message}`);
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log('Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
