'use strict';

const HIDDEN = new Set([
  'escalation_level',
  'escalation_fired',
  'internal_note',
  'quality_flag',
  'csat_flag',
  'dashboard_pinned',
  'pause_streak',
  'assigned_to',
]);

const STATUS_PLAIN = {
  NEW: 'Received',
  TRIAGED: 'Being reviewed',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  PENDING: 'Waiting',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

function portalTicketView(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (HIDDEN.has(k)) continue;
    out[k] = v;
  }
  out.status_label = STATUS_PLAIN[row.status] || row.status;
  return out;
}

function portalHasEscalation(payload) {
  const text = JSON.stringify(payload);
  return /escalation_level/.test(text);
}

module.exports = {
  HIDDEN,
  STATUS_PLAIN,
  portalTicketView,
  portalHasEscalation,
};
