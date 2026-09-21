/**
 * Part 2 acceptance criterion 6 — concurrency.
 *
 * "Two simultaneous transitions on one serial — one wins, one fails cleanly, no
 * lost update. Test with real concurrent requests, not a mock."
 *
 * So this uses two real pg clients on two real transactions against the real
 * database. A stub cannot exercise what is being tested: the whole mechanism is
 * `SELECT ... FOR UPDATE` making the second reader wait for the first
 * transaction to commit, which is behaviour that lives in Postgres, not in
 * JavaScript. Mocking it would test the mock.
 *
 * Before Part 2.1 added FOR UPDATE to loadSerial, both callers read the same
 * "from" state, both passed validation, and both wrote — the second silently
 * overwriting the first. That is finding I5.
 *
 * Skips cleanly when no database is configured, like billingIntegration does,
 * so this stays runnable in a bare checkout.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });

const hasDb = Boolean(process.env.DATABASE_URL || process.env.DB_HOST || process.env.PGHOST);

describe('Part 2 acceptance 6 — two simultaneous transitions on one serial', { skip: !hasDb ? 'no database configured' : false }, () => {
  let pool;
  let transitionAsset;
  let isTransitionRefused;
  let serialId;
  let original;

  before(async () => {
    pool = require('../config/db');
    ({ transitionAsset } = require('../services/inventoryStateMachine'));
    ({ isTransitionRefused } = require('../utils/transitionRefusal'));

    // A real in_stock asset. Its status is restored in after().
    const { rows } = await pool.query(
      `SELECT serial_id, inventory_status
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND inventory_status = 'in_stock'
          AND current_customer_id IS NULL
        ORDER BY serial_id LIMIT 1`
    );
    if (!rows.length) throw new Error('no in_stock asset available to test against');
    serialId = rows[0].serial_id;
    original = rows[0].inventory_status;
  });

  after(async () => {
    if (!serialId) return;
    // Put it back exactly as found. The events and transitions rows written by
    // the test stay — the log is append-only by design, and a test that could
    // erase its own history would defeat the table's purpose.
    await pool.query(
      `UPDATE vendor_serial_numbers
          SET inventory_status = $2, current_dc_number = NULL, current_customer_id = NULL,
              updated_at = NOW()
        WHERE serial_id = $1`,
      [serialId, original]
    );
  });

  it('serialises two concurrent transitions: one wins, one is refused, no lost update', async () => {
    const a = await pool.connect();
    const b = await pool.connect();

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      // A moves in_stock -> reserved and holds its transaction open. The row
      // lock is taken here.
      const first = await transitionAsset(a, {
        serialId,
        toStatus: 'reserved',
        reason: 'concurrency test: first writer',
        caller: 'test:concurrency:A',
      });
      assert.equal(first.ok, true, 'the first transition should succeed');
      assert.equal(first.from, 'in_stock');

      // B attempts the SAME move while A is still open. It must block on
      // FOR UPDATE rather than read the stale 'in_stock' and also succeed.
      let bSettled = false;
      const second = transitionAsset(b, {
        serialId,
        toStatus: 'dispatch_ready',
        reason: 'concurrency test: second writer',
        caller: 'test:concurrency:B',
      }).then(
        (r) => { bSettled = true; return { ok: true, r }; },
        (e) => { bSettled = true; return { ok: false, e }; }
      );

      // Give B a moment to prove it is genuinely blocked. If FOR UPDATE were
      // missing it would have read 'in_stock' and resolved by now.
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(bSettled, false, 'the second transition must block on the row lock, not race past it');

      await a.query('COMMIT');

      const outcome = await second;

      // B now reads the state A committed ('reserved'), and reserved ->
      // dispatch_ready is legal, so it succeeds from the NEW state rather than
      // from the stale one. That is the correct outcome: no lost update.
      if (outcome.ok) {
        assert.equal(outcome.r.from, 'reserved',
          'the second writer must see the state the first one committed, not the state it started from');
        await b.query('COMMIT');
      } else {
        // If the second move had been illegal from the new state it must be a
        // clean refusal, never a forced write.
        assert.ok(isTransitionRefused(outcome.e), `expected a clean refusal, got: ${outcome.e?.message}`);
        await b.query('ROLLBACK');
      }

      const { rows } = await pool.query(
        'SELECT inventory_status FROM vendor_serial_numbers WHERE serial_id = $1',
        [serialId]
      );
      assert.ok(
        ['reserved', 'dispatch_ready'].includes(rows[0].inventory_status),
        `expected a state one of the two writers actually set, got ${rows[0].inventory_status}`
      );
    } finally {
      await a.query('ROLLBACK').catch(() => {});
      await b.query('ROLLBACK').catch(() => {});
      a.release();
      b.release();
    }
  });

  it('refuses the illegal half of a concurrent pair cleanly', async () => {
    const a = await pool.connect();
    const b = await pool.connect();

    // The previous test leaves the unit wherever its winner put it, so reset to
    // a known state first. allowOverride because this is test setup, not a
    // business move — and using the machine rather than a raw UPDATE keeps the
    // test honest about the rule it is testing.
    await transitionAsset(pool, {
      serialId, toStatus: 'in_stock', reason: 'concurrency test: reset',
      allowOverride: true, caller: 'test:concurrency:reset',
    });

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      // A walks the unit to dispatch_ready and holds the transaction open.
      await transitionAsset(a, {
        serialId, toStatus: 'reserved', reason: 'setup', caller: 'test:concurrency:setup',
      });
      await transitionAsset(a, {
        serialId, toStatus: 'dispatch_ready', reason: 'setup', caller: 'test:concurrency:setup',
      });

      // B wants to put it straight back on the shelf as rented, which the map
      // forbids from dispatch_ready.
      const second = transitionAsset(b, {
        serialId, toStatus: 'rented', reason: 'concurrency test: illegal move', caller: 'test:concurrency:B2',
      }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));

      await a.query('COMMIT');
      const outcome = await second;

      assert.equal(outcome.ok, false, 'dispatch_ready -> rented must be refused');
      assert.ok(isTransitionRefused(outcome.e), 'it must be a typed refusal, not a generic error');
      assert.equal(outcome.e.from, 'dispatch_ready', 'the refusal must name the state the winner left behind');
      assert.equal(outcome.e.to, 'rented');

      await b.query('ROLLBACK');

      const { rows } = await pool.query(
        'SELECT inventory_status FROM vendor_serial_numbers WHERE serial_id = $1',
        [serialId]
      );
      assert.equal(rows[0].inventory_status, 'dispatch_ready',
        'the refused writer must not have changed anything');
    } finally {
      await a.query('ROLLBACK').catch(() => {});
      await b.query('ROLLBACK').catch(() => {});
      a.release();
      b.release();
    }
  });
});
