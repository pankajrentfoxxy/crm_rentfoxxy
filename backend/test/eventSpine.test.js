/**
 * Part 2.1 — the event spine, and the two map additions it depends on.
 *
 * Pure unit tests against a stub client: what matters is the shape of what gets
 * written and that the state machine writes it at all, not that Postgres can
 * insert a row. The append-only trigger is verified against the real database
 * in the migration, where it belongs.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });

const { ALLOWED, isAllowed, STATUS } = require('../services/inventoryStateMachine');
const eventService = require('../services/eventService');

describe('2.1 — I6: the two transitions the map was missing', () => {
  it('permits dispatch_ready -> qc_failed', () => {
    assert.equal(isAllowed('dispatch_ready', 'qc_failed'), true);
    assert.ok(ALLOWED.dispatch_ready.includes('qc_failed'));
  });

  it('permits in_transit -> returned', () => {
    assert.equal(isAllowed('in_transit', 'returned'), true);
    assert.ok(ALLOWED.in_transit.includes('returned'));
  });

  it('keeps scrapped terminal — I7 must not regress', () => {
    assert.deepEqual(ALLOWED.scrapped, []);
    assert.equal(isAllowed('scrapped', 'in_stock'), false);
  });

  it('still refuses a jump that skips transit', () => {
    assert.equal(isAllowed('in_stock', 'rented'), false);
    assert.equal(isAllowed('reserved', 'rented'), false);
  });

  it('still treats a non-canonical current status as unvalidatable (I2, until 2.3)', () => {
    // This is the defect, asserted so the fix in Part 2.3 has something to flip.
    // One bad write currently exempts an asset from validation permanently.
    assert.equal(isAllowed('out_for_repare', 'rented'), true);
  });
});

describe('2.1 — recordEvent writes the shape a timeline needs', () => {
  let captured;
  const db = {
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [{ event_id: 42 }] };
    },
  };
  beforeEach(() => { captured = null; });

  it('returns the new event id', async () => {
    const id = await eventService.recordEvent(db, {
      entityType: 'asset', entityId: 'TTSPL1', eventType: 'status_changed', source: 'test',
    });
    assert.equal(id, 42);
  });

  it('carries the correlation id through', async () => {
    const cid = eventService.newCorrelationId();
    await eventService.recordEvent(db, {
      entityType: 'asset', entityId: 'TTSPL1', eventType: 'status_changed',
      source: 'test', correlationId: cid,
    });
    assert.equal(captured.params[10], cid);
  });

  it('denormalises the actor name so it survives user deletion', async () => {
    await eventService.recordEvent(db, {
      entityType: 'asset', entityId: 'TTSPL1', eventType: 'x', source: 'test',
      actor: { user_id: 7, name: 'Nisha' },
    });
    assert.equal(captured.params[0], 'user');
    assert.equal(captured.params[1], 7);
    assert.equal(captured.params[2], 'Nisha');
  });

  it('falls back to system rather than writing an actorless event', async () => {
    await eventService.recordEvent(db, {
      entityType: 'asset', entityId: 'TTSPL1', eventType: 'x', source: 'test',
    });
    assert.equal(captured.params[0], 'system');
    assert.equal(captured.params[2], 'system');
  });

  it('refuses to write an event missing its source', async () => {
    const id = await eventService.recordEvent(db, {
      entityType: 'asset', entityId: 'TTSPL1', eventType: 'x',
    });
    assert.equal(id, null);
    assert.equal(captured, null, 'nothing should reach the database');
  });

  it('never throws when the insert fails — history must not break the write', async () => {
    const broken = { async query() { throw new Error('connection lost'); } };
    const id = await eventService.recordEvent(broken, {
      entityType: 'asset', entityId: 'TTSPL1', eventType: 'x', source: 'test',
    });
    assert.equal(id, null);
  });

  it('records the full reason rather than truncating it (I16)', async () => {
    // inventory_status_transitions.reason is varchar(255) and cuts a 2,000
    // character Dispatch QC failure down to the part before the detail.
    const long = 'x'.repeat(2000);
    await eventService.recordAssetEvent(db, {
      serialId: 1, ttsplId: 'TTSPL1', eventType: 'status_changed',
      source: 'test', payload: { reason: long },
    });
    const payload = JSON.parse(captured.params[9]);
    assert.equal(payload.reason.length, 2000, 'the event keeps what the varchar(255) column loses');
  });

  it('puts the ttspl in entity_ref so a timeline reads without joins', async () => {
    await eventService.recordAssetEvent(db, {
      serialId: 99, ttsplId: 'TTSPL4227', eventType: 'status_changed', source: 'test',
    });
    assert.equal(captured.params[4], 'TTSPL4227', 'entity_id');
    assert.equal(captured.params[5], 'TTSPL4227', 'entity_ref');
    assert.equal(JSON.parse(captured.params[9]).serial_id, 99);
  });
});

describe('2.1 — correlation ids', () => {
  it('mints a well-formed uuid', () => {
    assert.match(
      eventService.newCorrelationId(),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('mints a different one each time', () => {
    const a = eventService.newCorrelationId();
    const b = eventService.newCorrelationId();
    assert.notEqual(a, b);
  });
});

describe('2.1 — the canonical status list agrees with the state machine', () => {
  it('every STATUS value is a key in ALLOWED', () => {
    for (const s of Object.values(STATUS)) {
      assert.ok(Object.prototype.hasOwnProperty.call(ALLOWED, s), `${s} missing from ALLOWED`);
    }
  });

  it('every transition target is itself a canonical status', () => {
    const canonical = new Set(Object.values(STATUS));
    for (const [from, tos] of Object.entries(ALLOWED)) {
      for (const to of tos) {
        assert.ok(canonical.has(to), `${from} -> ${to}: "${to}" is not canonical`);
      }
    }
  });

  it('does not yet know at_gate — Part 3 adds it', () => {
    // Asserted so Part 3 has a test that fails before its own change.
    assert.equal(Object.values(STATUS).includes('at_gate'), false);
  });
});
