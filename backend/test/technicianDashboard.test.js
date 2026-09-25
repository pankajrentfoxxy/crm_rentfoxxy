/**
 * The technician portal lists the technician's real challans. It used to match
 * only status 'pending' by user id, which no current challan has.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const { getTechnicianDashboard } = require('../services/technicianAuthService');

describe('technician portal dashboard', () => {
  const dcs = [`TEST-TECHDASH-A-${Date.now()}`, `TEST-TECHDASH-B-${Date.now()}`, `TEST-TECHDASH-C-${Date.now()}`];
  const techId = 987654321;
  after(async () => {
    await pool.query('DELETE FROM delivery_challan_lines WHERE dc_number = ANY($1)', [dcs]);
    await pool.end();
  });

  it('shows out-for-delivery and waiting-at-gate challans assigned by technician id', async () => {
    await pool.query(
      `INSERT INTO delivery_challan_lines (dc_number, customer_name, status, movement_type, delivery_person_id) VALUES
         ($1, 'test', 'in_transit', 'outbound', $4),
         ($2, 'test', 'dispatch_ready', 'outbound', $4),
         ($3, 'test', 'delivered', 'outbound', $4)`,
      [...dcs, techId]
    );
    const r = await getTechnicianDashboard(techId, null);
    const mine = r.deliveries.filter((d) => dcs.includes(d.dc_number)).map((d) => d.status);
    assert.deepEqual(mine, ['in_transit', 'dispatch_ready'], 'delivered is not listed; out-for-delivery comes first');
    assert.equal(r.pending_count, 1);
    assert.equal(r.upcoming_count, 1);
  });
});
