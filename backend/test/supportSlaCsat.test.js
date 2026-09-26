/**
 * Support SLA (business hours 09:00-19:00 IST Mon-Sat, pauses) and CSAT
 * (token on close, one answer, public shape). claude/carret-support.md S5, S6.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { businessMinutes, addBusinessMinutes } = require('../services/supportSlaService');

// IST wall-clock → Date (IST = UTC+5:30).
const ist = (y, m, d, hh, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh, mm) - 330 * 60000);

describe('SLA business time', () => {
  it('counts only 09:00-19:00 IST, Monday to Saturday', () => {
    // Sat 26 Sep 2026 18:00 → Mon 28 Sep 10:00 = 1 h Sat + 0 Sun + 1 h Mon
    assert.equal(businessMinutes(ist(2026, 9, 26, 18), ist(2026, 9, 28, 10)), 120);
    // overnight counts nothing
    assert.equal(businessMinutes(ist(2026, 9, 28, 19), ist(2026, 9, 29, 9)), 0);
    // a full working day
    assert.equal(businessMinutes(ist(2026, 9, 28, 8), ist(2026, 9, 28, 20)), 600);
  });

  it('pauses (customer hold, waiting for a part) are left out', () => {
    const p = [{ from: ist(2026, 9, 28, 11), to: ist(2026, 9, 28, 13) }];
    assert.equal(businessMinutes(ist(2026, 9, 28, 9), ist(2026, 9, 28, 19), p), 480);
  });

  it('a due time rolls over nights and Sundays', () => {
    // 4 business hours from Sat 17:00 → Sat 19:00 (2 h) + Mon 09:00-11:00
    assert.equal(addBusinessMinutes(ist(2026, 9, 26, 17), 240).toISOString(), ist(2026, 9, 28, 11).toISOString());
  });
});

describe('CSAT', () => {
  const hx = require('./helpers/rollbackHarness');
  let C;
  before(async () => { C = await hx.open(); });
  after(async () => { await hx.close(); });

  it('closing a ticket makes one feedback link; the public page shows no contact details; one answer only', async () => {
    const t = (await C.query("SELECT id FROM support_tickets WHERE status IN ('open','in_progress') LIMIT 1")).rows[0];
    assert.ok(t);
    await C.query("UPDATE support_tickets SET status = 'closed', closed_at = NOW() WHERE id = $1", [t.id]);
    const row = (await C.query('SELECT token FROM support_csat WHERE ticket_id = $1', [t.id])).rows[0];
    assert.match(row.token, /^[a-f0-9]{32}$/);
    const csat = require('../services/supportCsatService');
    const pub = await csat.getPublicFeedback(row.token);
    assert.deepEqual(Object.keys(pub).sort(), ['company', 'expired', 'rating', 'submitted', 'ticket_id']);
    await assert.rejects(csat.submitFeedback(row.token, { rating: 6 }), /1 to 5/);
    await csat.submitFeedback(row.token, { rating: 5, comment: 'Quick fix' });
    await assert.rejects(csat.submitFeedback(row.token, { rating: 1 }), /used or has expired/);
    const s = await csat.csatSummary({ days: 1 });
    assert.ok(s.answered >= 1);
  });
});
