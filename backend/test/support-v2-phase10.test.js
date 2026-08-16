'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  elapsedPct,
  crossedLevels,
  shouldSkipTicket,
  woNeedsAcceptanceAlert,
} = require('../services/supportSlaWorker');
const {
  validatePause,
  nextPauseStreak,
  shouldFlagPauseAbuse,
  reopenWindowError,
  validateCreate,
} = require('../services/supportTicketFlowService');
const { renderTemplate, templateOutcome } = require('../services/supportNotificationService');
const { csatTokenState } = require('../services/supportCsatService');
const { portalTicketView, portalHasEscalation } = require('../services/supportPortalView');
const { resolveApproverRole, approvalOverdue } = require('../services/supportApprovalRules');
const { supportPublicRateLimit, _resetRateLimitForTests } = require('../middleware/supportPublicRateLimit');

const now = new Date('2026-08-17T12:00:00Z');

test('phase 10: sweep fires level 2 once; second pass does not re-fire', () => {
  const start = new Date('2026-08-17T10:00:00Z');
  const due = new Date('2026-08-17T12:40:00Z');
  const pct = elapsedPct(start, due, now);
  assert.ok(pct >= 75 && pct < 100, `expected ~75%, got ${pct}`);
  const first = crossedLevels(pct, {});
  assert.deepEqual(first, [1, 2]);
  const fired = { 1: true, 2: true };
  assert.deepEqual(crossedLevels(pct, fired), []);
});

test('phase 10: paused ticket is skipped; breach at 100% is level 3', () => {
  assert.equal(shouldSkipTicket({ status: 'IN_PROGRESS', sla_paused: true }), true);
  assert.equal(shouldSkipTicket({ status: 'RESOLVED', sla_paused: false }), true);
  assert.equal(shouldSkipTicket({ status: 'IN_PROGRESS', sla_paused: false }), false);
  const start = new Date('2026-08-17T10:00:00Z');
  const due = new Date('2026-08-17T12:00:00Z');
  const pct = elapsedPct(start, due, now);
  assert.ok(pct >= 100);
  assert.ok(crossedLevels(pct, {}).includes(3));
});

test('phase 10: WO unaccepted 30 min before slot alerts the lead once', () => {
  const slot = new Date('2026-08-17T12:20:00Z');
  assert.equal(woNeedsAcceptanceAlert({ status: 'ASSIGNED', slot_start: slot, acceptance_alert_fired: false }, now), true);
  assert.equal(woNeedsAcceptanceAlert({ status: 'ACCEPTED', slot_start: slot, acceptance_alert_fired: false }, now), false);
  assert.equal(woNeedsAcceptanceAlert({ status: 'ASSIGNED', slot_start: slot, acceptance_alert_fired: true }, now), false);
});

test('phase 10: PENDING_CUSTOMER without contact attempt is rejected', () => {
  assert.ok(validatePause({ reason: 'PENDING_CUSTOMER' }));
  assert.ok(validatePause({ reason: 'PENDING_CUSTOMER', contact_method: 'CALL' }));
  assert.equal(validatePause({
    reason: 'PENDING_CUSTOMER',
    contact_method: 'WHATSAPP',
    contact_reference: 'wa-991',
  }), null);
});

test('phase 10: third consecutive pause flags the lead', () => {
  assert.equal(nextPauseStreak(0), 1);
  assert.equal(nextPauseStreak(2), 3);
  assert.equal(shouldFlagPauseAbuse(2), false);
  assert.equal(shouldFlagPauseAbuse(3), true);
});

test('phase 10: inactive template is SKIPPED; render fills placeholders', () => {
  assert.equal(templateOutcome(null), 'SKIPPED');
  assert.equal(templateOutcome({ active: false }), 'SKIPPED');
  assert.equal(templateOutcome({ active: true }), 'QUEUED');
  assert.equal(
    renderTemplate('Hi {{tech_name}} ({{tech_phone}}) for {{ticket_number}}. ETA {{eta}}.', {
      tech_name: 'Rahul',
      tech_phone: '9876543210',
      ticket_number: 'STK-1001',
      eta: '2–4 pm',
    }),
    'Hi Rahul (9876543210) for STK-1001. ETA 2–4 pm.'
  );
});

test('phase 10: CSAT token is one-use and expired is friendly', () => {
  const used = csatTokenState({ used_at: now, expires_at: '2026-08-20T00:00:00Z' }, now);
  assert.equal(used.ok, false);
  assert.equal(used.reason, 'used');
  const expired = csatTokenState({ used_at: null, expires_at: '2026-08-16T00:00:00Z' }, now);
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'expired');
  assert.match(expired.message, /expired/i);
  const ok = csatTokenState({ used_at: null, expires_at: '2026-08-20T00:00:00Z' }, now);
  assert.equal(ok.ok, true);
});

test('phase 10: reopen day 6 ok, day 8 refused; second reopen is quality', () => {
  assert.equal(reopenWindowError(new Date('2026-08-11T12:00:00Z'), now), null);
  assert.equal(reopenWindowError(new Date('2026-08-08T12:00:00Z'), now), 'Reopen window is 7 days');
  assert.equal(shouldFlagPauseAbuse(2), false);
  const reopenCount = 2;
  assert.ok(reopenCount >= 2);
});

test('phase 10: portal payload never includes escalation_level', () => {
  const view = portalTicketView({
    ticket_id: 9,
    ticket_number: 'STK-9',
    status: 'IN_PROGRESS',
    escalation_level: 4,
    internal_note: 'secret',
    sla_resolution_due_at: '2026-08-17T16:00:00Z',
  });
  assert.equal(view.escalation_level, undefined);
  assert.equal(view.internal_note, undefined);
  assert.equal(view.status_label, 'In progress');
  assert.equal(portalHasEscalation(view), false);
});

test('phase 10: portal create requires the same classification as an agent', () => {
  const bad = validateCreate({
    customer_id: 1,
    channel: 'PORTAL',
    contact_name: 'Asha',
    contact_phone: '9876543210',
    asset_lines: [{ reported_description: 'too short' }],
  });
  assert.equal(bad.ok, false);
});

test('phase 10: approval wait over 4h on P1 is overdue', () => {
  const created = new Date('2026-08-17T07:00:00Z');
  assert.equal(approvalOverdue({ status: 'PENDING', priority: 1, created_at: created }, now), true);
  assert.equal(approvalOverdue({ status: 'APPROVED', priority: 1, created_at: created }, now), false);
});

test('phase 10: public CSAT is rate limited', () => {
  _resetRateLimitForTests();
  const mw = supportPublicRateLimit({ windowMs: 60_000, max: 2 });
  const req = { ip: '1.2.3.4', path: '/csat/abc', headers: {} };
  let status = 200;
  const res = { status: (n) => { status = n; return { json: () => {} }; } };
  let nexts = 0;
  mw(req, res, () => { nexts += 1; });
  mw(req, res, () => { nexts += 1; });
  mw(req, res, () => { nexts += 1; });
  assert.equal(nexts, 2);
  assert.equal(status, 429);
});

test('phase 10: close of a breached ticket requires a reason in API and SQL', () => {
  const ctrl = fs.readFileSync(path.join(__dirname, '../controllers/supportV2TicketController.js'), 'utf8');
  assert.match(ctrl, /breach_reason required for a breached ticket/);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/211_support_v2_notifications.sql'), 'utf8');
  assert.match(sql, /chk_breach_reason_on_close/);
  assert.match(sql, /support_notification_templates/);
  assert.match(sql, /support_csat_tokens/);
  assert.match(sql, /support_approval_rules/);
});

test('phase 10: one decideApproval path; worker started behind the existing flag', () => {
  const ret = fs.readFileSync(path.join(__dirname, '../services/supportReturnPickupService.js'), 'utf8');
  assert.equal((ret.match(/async function decideApproval/g) || []).length, 1);
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /startSupportSlaWorker/);
  assert.match(server, /ENABLE_BACKGROUND_WORKERS/);
  const health = fs.readFileSync(path.join(__dirname, '../controllers/supportV2Controller.js'), 'utf8');
  assert.match(health, /phase:\s*1[01]/);
});

test('phase 10: new files do not touch delivery_person_id or raw inventory_status', () => {
  const files = [
    'services/supportSlaWorker.js',
    'services/supportNotificationService.js',
    'services/supportCsatService.js',
    'services/supportApprovalRules.js',
    'services/supportPortalView.js',
    'controllers/supportV2PublicController.js',
    'controllers/supportV2PortalController.js',
  ];
  const needle = /\[\s*'rented'\s*,\s*'on_demo'\s*,\s*'sold'\s*,\s*'out_stock'\s*\]/;
  const offenders = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    if (needle.test(text)) offenders.push(`${rel}:eligibility`);
    if (/delivery_person_id/.test(text)) offenders.push(`${rel}:delivery_person_id`);
    if (/UPDATE\s+vendor_serial_numbers[\s\S]{0,200}inventory_status\s*=/i.test(text)) {
      offenders.push(`${rel}:inventory_status`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('phase 10: approval rules fall back when the table is missing', async () => {
  const db = {
    async query() {
      throw Object.assign(new Error('relation "support_approval_rules" does not exist'), { code: '42P01' });
    },
  };
  const rule = await resolveApproverRole(db, 'DAMAGE_CHARGE', 500);
  assert.equal(rule.approver_role, 'support_lead');
  const mgr = await resolveApproverRole(db, 'DAMAGE_CHARGE', 50000);
  assert.equal(mgr.approver_role, 'support_manager');
});
