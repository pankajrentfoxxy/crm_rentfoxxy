'use strict';

/**
 * Pickup-type decision table (PLAN D3/D4/D5).
 * First match wins. Never use `source_item_id ? 'repair' : 'return'`.
 */
function resolvePickupType(item, ctx = {}) {
  if (item && item.service_dc_number) {
    return { wo_type: 'REPAIR_PICKUP', confidence: 'HIGH', rule: 'SERVICE_DC' };
  }
  if (ctx.hasCreditNote) {
    return { wo_type: 'RETURN_PICKUP', confidence: 'HIGH', rule: 'CREDIT_NOTE_7D' };
  }
  if (ctx.hasReplacementPickup) {
    return { wo_type: 'RETURN_PICKUP', confidence: 'HIGH', rule: 'REPLACEMENT_COLLECT' };
  }
  const explicit = String(item && item.pickup_type || '').toLowerCase();
  if (explicit === 'repair' || explicit === 'return') {
    return {
      wo_type: explicit === 'repair' ? 'REPAIR_PICKUP' : 'RETURN_PICKUP',
      confidence: 'MEDIUM',
      rule: 'EXPLICIT_PICKUP_TYPE',
    };
  }
  if (ctx.everAwaitingServiceReturn) {
    return { wo_type: 'REPAIR_PICKUP', confidence: 'MEDIUM', rule: 'AWAITING_SERVICE_RETURN' };
  }
  if (ctx.serialReturnedOrStockNotAssigned) {
    return { wo_type: 'RETURN_PICKUP', confidence: 'LOW', rule: 'SERIAL_NOT_ASSIGNED' };
  }
  return { wo_type: 'RETURN_PICKUP', confidence: 'LOW', rule: 'FALLBACK' };
}

const ITEM_STATUS_MAP = {
  pending_dispatch: { status: 'PENDING_ASSIGNMENT' },
  assigned: { status: 'ASSIGNED' },
  in_transit: { status: 'EN_ROUTE' },
  visited: { status: 'ON_SITE' },
  work_done: { status: 'IN_PROGRESS' },
  awaiting_otp: { status: 'IN_PROGRESS' },
  picked_up: { status: 'COMPLETED', otpDone: true },
  awaiting_service_return: { status: 'COMPLETED', followOnServiceReturn: true },
  returned: { status: 'COMPLETED' },
  inventory_updated: { status: 'COMPLETED' },
  repair_failed: { status: 'FAILED', failure_reason: 'LEGACY_REPAIR_FAILED' },
  swap_initiated: { status: 'COMPLETED', replacementGroup: true },
  resolved: { status: 'COMPLETED' },
  closed: { status: 'COMPLETED' },
  cancelled: { status: 'CANCELLED' },
  open: { status: 'DRAFT' },
  delivered: { status: 'COMPLETED' },
  order_placed: { status: 'PENDING_ASSIGNMENT' },
};

function mapItemStatus(status) {
  return ITEM_STATUS_MAP[String(status || '').toLowerCase()] || { status: 'DRAFT' };
}

function mapTicketStatus(status, anyItemAssigned) {
  const s = String(status || '').toLowerCase();
  if (s === 'closed') return 'CLOSED';
  if (s === 'cancelled') return 'CANCELLED';
  if (s === 'in_progress') return 'IN_PROGRESS';
  if (s === 'open') return anyItemAssigned ? 'ASSIGNED' : 'NEW';
  return 'NEW';
}

const LEGACY_PRIORITY = { urgent: 1, high: 2, normal: 3, low: 4 };

const ISSUE_CATEGORY_MAP = {
  'Hardware / performance': 'HW-MBD',
  'Display / keyboard / touchpad': 'HW-DIS',
  'Battery / charging': 'HW-BAT',
  'Software / OS': 'SW-OS',
  'Network / Wi-Fi': 'NET-WIF',
  'Pickup / return logistics': 'LOG-RET',
  Other: 'SVC-OTH',
};

function mapIssueCategory(name) {
  if (!name) return 'SVC-OTH';
  return ISSUE_CATEGORY_MAP[name] || 'SVC-OTH';
}

module.exports = {
  resolvePickupType,
  mapItemStatus,
  mapTicketStatus,
  mapIssueCategory,
  LEGACY_PRIORITY,
  ISSUE_CATEGORY_MAP,
  ITEM_STATUS_MAP,
};
