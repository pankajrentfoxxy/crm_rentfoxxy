'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_VIEWS, applyFilterBag, buildTicketFilters, sortSql } = require('../services/supportTicketQuery');

test('phase 3: seven system view slugs', () => {
  assert.deepEqual(Object.keys(SYSTEM_VIEWS).sort(), [
    'all_open', 'breaching', 'field_jobs_today', 'mine',
    'pending_customer', 'resolved_7d', 'unassigned',
  ]);
});

test('phase 3: view then explicit filters both apply', () => {
  const { conds, where } = buildTicketFilters({
    viewFilters: SYSTEM_VIEWS.all_open,
    query: { priority: '1', sla: 'PAUSED' },
    userId: 9,
  });
  assert.match(where, /NOT IN/);
  assert.ok(conds.some((c) => c.includes('priority')));
  assert.ok(conds.some((c) => c.includes('sla_paused')));
});

test('phase 3: ME resolves to the caller', () => {
  const conds = [];
  const params = [];
  applyFilterBag({ assigned_to: 'ME' }, 42, conds, params);
  assert.deepEqual(params, [42]);
  assert.ok(conds[0].includes('assigned_to'));
});

test('phase 3: sort keys are server-side only', () => {
  assert.match(sortSql('priority_sla'), /priority ASC/);
  assert.match(sortSql('newest'), /created_at DESC/);
  assert.match(sortSql('unknown'), /priority ASC/);
});
