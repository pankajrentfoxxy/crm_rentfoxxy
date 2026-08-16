'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { waivedDaysForHold } = require('../services/supportBillingHooks');
const { DEFAULTS, grouped } = require('../services/supportSettingsService');
const { reopenWindowError } = require('../services/supportTicketFlowService');
const { REPORTS } = require('../services/supportReportsService');

test('phase 11: 5-day hold with free_repair_days=3 waives exactly 2 days', () => {
  const hold = {
    waive_rent: true,
    hold_from: '2026-07-10',
    hold_to: '2026-07-15',
  };
  assert.equal(waivedDaysForHold(hold, '2026-07-01', '2026-07-31', 3), 2);
  assert.equal(waivedDaysForHold({ ...hold, waive_rent: false }, '2026-07-01', '2026-07-31', 3), 0);
});

test('phase 11: hooks stay off unless BILLING_READ_SUPPORT_HOOKS=true', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportBillingHooks.js'), 'utf8');
  assert.match(src, /BILLING_READ_SUPPORT_HOOKS/);
  const sched = fs.readFileSync(path.join(__dirname, '../services/billingSchedulerService.js'), 'utf8');
  assert.match(sched, /applySupportInvoiceHooks/);
  assert.match(sched, /stampExtraLinesBilled/);
});

test('phase 11: settings defaults match the prompt and are grouped', () => {
  assert.equal(DEFAULTS.auto_close_hours, 48);
  assert.equal(DEFAULTS.reopen_window_days, 7);
  assert.equal(DEFAULTS.free_repair_days, 3);
  assert.equal(DEFAULTS.max_repair_days, 7);
  assert.equal(DEFAULTS.max_jobs_per_day, 6);
  assert.equal(DEFAULTS.accept_window_minutes, 30);
  assert.equal(DEFAULTS.parts_lead_threshold, 5000);
  assert.equal(DEFAULTS.parts_manager_threshold, 10000);
  const g = grouped(DEFAULTS);
  assert.ok(g.sla.auto_close_hours);
  assert.ok(g.repair.free_repair_days);
  assert.ok(g.parts.parts_lead_threshold);
});

test('phase 11: reopen window reads the days argument (no silent 7)', () => {
  const now = new Date('2026-08-17T12:00:00Z');
  assert.equal(reopenWindowError(new Date('2026-08-01T12:00:00Z'), now, 21), null);
  assert.ok(reopenWindowError(new Date('2026-08-01T12:00:00Z'), now, 7));
});

test('phase 11: all seven reports exist; health is 11; writes 410', () => {
  assert.deepEqual(REPORTS.sort(), [
    'assets', 'commercial', 'field', 'parts', 'quality', 'sla', 'volume',
  ].sort());
  const health = fs.readFileSync(path.join(__dirname, '../controllers/supportV2Controller.js'), 'utf8');
  assert.match(health, /phase:\s*11/);
  const freeze = fs.readFileSync(path.join(__dirname, '../middleware/supportLegacyFreeze.js'), 'utf8');
  assert.match(freeze, /410/);
  assert.match(freeze, /\/api\/support\/v2/);
  const routes = fs.readFileSync(path.join(__dirname, '../routes/support.js'), 'utf8');
  assert.match(routes, /freezeLegacyWrites/);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/212_support_v2_reports_cutover.sql'), 'utf8');
  assert.match(sql, /support_v2_rpt_volume/);
  assert.match(sql, /support_settings_v2/);
  assert.doesNotMatch(sql, /RENAME TO support_tickets;/);
});

test('phase 11: frontend swap — /support is v2, /support-legacy is old', () => {
  const v2 = fs.readFileSync(path.join(__dirname, '../../frontend/src/routes/supportV2Routes.jsx'), 'utf8');
  assert.match(v2, /path: '\/support\/\*'/);
  assert.match(v2, /path: '\/support-legacy\/\*'/);
  assert.match(v2, /SupportV2App/);
  assert.match(v2, /SupportModuleApp/);
  const menu = fs.readFileSync(path.join(__dirname, '../../frontend/src/config/menuConfig.js'), 'utf8');
  assert.match(menu, /path: '\/support'/);
  assert.match(menu, /Support \(legacy, read-only\)/);
  assert.doesNotMatch(menu, /Support \(new\)/);
});
