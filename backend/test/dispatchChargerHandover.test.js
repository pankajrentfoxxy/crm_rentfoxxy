const test = require('node:test');
const assert = require('node:assert/strict');
const { handoverBlockers, detailedRequest } = require('../services/dispatchChargerService');

const complete = {
  request_id: 1,
  request_number: 'DCR-0001',
  disposition: 'attach',
  status: 'pending',
  laptop_ttspl: 'TTSPL6314',
  laptop_serial: '7VT4HK3',
  laptop_brand: 'Dell',
  laptop_model: 'Latitude 5420',
  so_number: 'SO/26-27/1349',
  requested_by: 46,
  requested_by_name: 'Sunil Kumar',
  requested_at: new Date(),
  ticket_status: 'in_progress',
  allocation_status: 'attached',
  so_status: 'open',
  units: [],
};

test('a complete pending request can be handed over', () => {
  assert.deepEqual(handoverBlockers(complete), []);
  const pub = detailedRequest(complete);
  assert.equal(pub.can_hand_over, true);
  assert.equal(pub.sales_order_number, 'SO/26-27/1349');
});

test('missing laptop, order or requester blocks the handover', () => {
  const row = { ...complete, laptop_ttspl: null, laptop_brand: null, laptop_model: null, so_number: null, requested_by_name: null };
  const b = handoverBlockers(row);
  assert.ok(b.some((x) => /TTSPL/.test(x)));
  assert.ok(b.some((x) => /brand/.test(x)));
  assert.ok(b.some((x) => /Sales order/.test(x)));
  assert.ok(b.some((x) => /Requested-by/.test(x)));
  assert.equal(detailedRequest(row).can_hand_over, false);
});

test('cancelled ticket, removed laptop or cancelled order blocks the handover', () => {
  assert.ok(handoverBlockers({ ...complete, ticket_status: 'cancelled' }).length);
  assert.ok(handoverBlockers({ ...complete, allocation_status: 'removed' }).length);
  assert.ok(handoverBlockers({ ...complete, so_status: 'Cancelled' }).length);
});

test('only a pending request offers the handover', () => {
  const pub = detailedRequest({ ...complete, status: 'handed_over' });
  assert.equal(pub.can_hand_over, false);
  assert.deepEqual(pub.handover_blockers, []);
});
