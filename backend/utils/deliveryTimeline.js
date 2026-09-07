'use strict';

const IN_TRANSIT = ['in_transit', 'reached', 'shipped'];
const DONE = new Set(['delivered', 'completed']);
const DISPATCHED = new Set([
  ...IN_TRANSIT,
  'dispatched',
  'out_for_delivery',
  'delivered',
  'completed',
]);

function sameInstant(a, b, ms = 2000) {
  if (!a || !b) return false;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return false;
  return Math.abs(da - db) <= ms;
}

/**
 * Timeline from the challan status and its own dates only.
 * Laptop serial dates are ignored — a rented unit from another DC must not
 * mark this challan delivered.
 */
function buildDeliveryTimeline(dc) {
  const status = String(dc.status || 'pending').toLowerCase();
  const createdAt = dc.created_at;
  const rejectedAt = dc.rejected_at || null;
  const statusDelivered = DONE.has(status);
  const statusDispatched = DISPATCHED.has(status);

  let deliveredAt = null;
  if (statusDelivered) {
    const raw = dc.delivered_at || dc.delivery_completed_at || null;
    deliveredAt = raw || createdAt;
  }

  let dispatchedAt = dc.dispatched_at || null;
  if (!dispatchedAt && (statusDelivered || statusDispatched)) {
    dispatchedAt = createdAt;
  }
  // Pending rows are often stamped delivered_at = created_at. Ignore that.
  if (!statusDispatched && dispatchedAt && sameInstant(dispatchedAt, createdAt) && !dc.dispatched_at) {
    dispatchedAt = null;
  }

  const steps = [
    { key: 'created', label: 'Challan created', at: createdAt },
    { key: 'dispatched', label: 'Dispatched', at: dispatchedAt },
  ];
  if (dc.reached_at && (statusDispatched || statusDelivered)) {
    steps.push({ key: 'reached', label: 'Reached location', at: dc.reached_at });
  }
  if (rejectedAt) {
    steps.push({ key: 'rejected', label: 'Refused', at: rejectedAt });
  } else {
    steps.push({ key: 'delivered', label: 'Delivered', at: deliveredAt });
  }
  return steps;
}

function applyDeliveryTimeline(dc) {
  const timeline = buildDeliveryTimeline(dc);
  return {
    timeline,
    status: dc.rejected_at ? 'rejected' : (dc.status || 'pending'),
    dispatched_at: timeline.find((s) => s.key === 'dispatched')?.at || null,
    delivered_at: timeline.find((s) => s.key === 'delivered')?.at || null,
  };
}

module.exports = {
  IN_TRANSIT,
  applyDeliveryTimeline,
  buildDeliveryTimeline,
};
