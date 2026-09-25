/**
 * Attach refusals must roll back before the connection goes back to the pool.
 *
 * attachSerial locks the serial FOR UPDATE after BEGIN. Five refusal branches
 * used to return without ROLLBACK, so the pooled connection went back still
 * inside a transaction, holding the row lock, and the next request to borrow it
 * inherited the open transaction. This drives two refusals and records every
 * statement sent on the borrowed client: nothing may be released mid-transaction.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const ctrl = require('../controllers/salesOrderSerialController');

function recordingPool() {
  const realConnect = pool.connect.bind(pool);
  const log = [];
  // pool.query() borrows through connect(callback); leave that form alone and
  // record only the explicit borrows the controller makes.
  pool.connect = async (...args) => {
    if (args.length) return realConnect(...args);
    const client = await realConnect();
    const realQuery = client.query.bind(client);
    const realRelease = client.release.bind(client);
    client.query = (text, ...rest) => {
      const sql = typeof text === 'string' ? text : text?.text || '';
      log.push(sql.trim().split(/\s+/)[0].toUpperCase());
      return realQuery(text, ...rest);
    };
    client.release = (...a) => { log.push('RELEASE'); client.query = realQuery; client.release = realRelease; return realRelease(...a); };
    return client;
  };
  return { log, restore: () => { pool.connect = realConnect; } };
}

const fakeRes = () => {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

async function pick() {
  const so = await pool.query(
    `SELECT sales_order_number, id FROM sales_order_lines
      WHERE COALESCE(status,'') <> 'cancelled' AND COALESCE(fulfillment_mode,'dispatch') = 'dispatch'
      ORDER BY id DESC LIMIT 1`
  );
  const serial = await pool.query('SELECT serial_id FROM asset_available LIMIT 1');
  return { so: so.rows[0], serialId: serial.rows[0]?.serial_id };
}

function assertNoOpenTransactionAtRelease(log) {
  let open = false;
  for (const stmt of log) {
    if (stmt === 'BEGIN') open = true;
    if (stmt === 'COMMIT' || stmt === 'ROLLBACK') open = false;
    if (stmt === 'RELEASE') assert.equal(open, false, `released inside a transaction: ${log.join(' → ')}`);
  }
}

describe('attachSerial refusals roll back', () => {
  after(async () => { await pool.end(); });

  it('rolls back when the requested line does not exist', async (t) => {
    const { so, serialId } = await pick();
    if (!so || !serialId) { t.skip('no order line or available serial in this database'); return; }
    const rec = recordingPool();
    try {
      const res = fakeRes();
      await ctrl.attachSerial(
        { params: { soNumber: so.sales_order_number }, body: { serial_id: serialId, line_id: 999999999 }, user: { user_id: 1, role: 'super_admin' } },
        res
      );
      assert.ok(res.code >= 400, `expected a refusal, got ${res.code}`);
      assertNoOpenTransactionAtRelease(rec.log);
    } finally {
      rec.restore();
    }
  });

  it('leaves the pool clean for the next borrower', async () => {
    const c = await pool.connect();
    try {
      const { rows } = await c.query('SELECT now() = statement_timestamp() AS fresh');
      // Inside a leaked transaction now() is frozen at BEGIN; on a clean
      // connection it equals the statement's own timestamp.
      assert.equal(rows[0].fresh, true);
    } finally {
      c.release();
    }
  });
});
