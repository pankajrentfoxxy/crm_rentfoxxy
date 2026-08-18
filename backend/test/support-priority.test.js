'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computePriority, MATRIX } = require('../services/supportPriorityService');

test('priority matrix covers all 9 cells', () => {
  const expected = {
    1: { 1: 1, 2: 2, 3: 3 },
    2: { 1: 2, 2: 3, 3: 4 },
    3: { 1: 3, 2: 4, 3: 4 },
  };
  assert.deepEqual(MATRIX, expected);
  for (const impact of [1, 2, 3]) {
    for (const urgency of [1, 2, 3]) {
      const { priority } = computePriority({ impact, urgency });
      assert.equal(priority, expected[impact][urgency]);
    }
  }
});

test('Platinum P3 → P2; Platinum P1 stays P1', () => {
  const p3 = computePriority({ impact: 2, urgency: 2, supportTier: 'PLATINUM' });
  assert.equal(p3.priority, 2);
  assert.ok(p3.reasons.some((r) => r.includes('Platinum')));

  const p1 = computePriority({ impact: 1, urgency: 1, supportTier: 'PLATINUM' });
  assert.equal(p1.priority, 1);
  assert.ok(p1.reasons.some((r) => r.includes('already P1')));
});

test('safety issue forces P1 over a P4 matrix cell', () => {
  const r = computePriority({ impact: 3, urgency: 3, isSafety: true });
  assert.equal(r.priority, 1);
  assert.ok(r.reasons.some((x) => x.includes('Safety')));
});

test('Repeat + Platinum + P4 → P2 with both reasons', () => {
  const r = computePriority({ impact: 2, urgency: 3, supportTier: 'PLATINUM', isRepeat: true });
  assert.equal(r.priority, 2);
  assert.ok(r.reasons.some((x) => x.includes('Platinum')));
  assert.ok(r.reasons.some((x) => x.includes('Repeat')));
});

test('invalid impact/urgency throws 400', () => {
  assert.throws(() => computePriority({ impact: 9, urgency: 1 }), (e) => e.status === 400);
});
