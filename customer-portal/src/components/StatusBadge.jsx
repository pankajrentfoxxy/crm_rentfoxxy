import React from 'react';
import { humanize } from '../utils/format';

/**
 * Single source of truth for status colours across the portal, so an order,
 * delivery or ticket showing the same state always looks the same.
 */
const TONE = {
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  red: 'bg-red-100 text-red-700',
  slate: 'bg-slate-100 text-slate-600',
};

const STATUS_TONES = {
  // Orders
  delivered: 'green',
  partially_delivered: 'amber',
  dispatched: 'blue',
  in_transit: 'blue',
  not_dispatched: 'slate',
  pending: 'amber',
  cancelled: 'slate',
  active: 'green',

  // Payments
  paid: 'green',
  partially_paid: 'amber',
  unpaid: 'red',
  monthly_invoicing: 'blue',
  not_applicable: 'slate',
  draft: 'slate',
  sent: 'red',

  // Deliveries
  reached: 'blue',
  shipped: 'blue',
  rejected: 'red',

  // Tickets
  open: 'blue',
  in_progress: 'amber',
  closed: 'green',
  resolved: 'green',
  received: 'blue',
  picked_up: 'purple',
  at_service_centre: 'purple',
  replacement_in_progress: 'purple',
  out_for_delivery: 'amber',

  // Assets
  rented: 'green',
  sold: 'green',
  on_demo: 'blue',
  returned: 'slate',
};

const LABEL_OVERRIDES = {
  monthly_invoicing: 'Monthly Invoicing',
  not_applicable: 'N/A',
  not_dispatched: 'Not Dispatched',
  at_service_centre: 'At Service Centre',
};

export default function StatusBadge({ status, label, tone, className = '' }) {
  if (!status && !label) return <span className="text-slate-400">—</span>;
  const key = String(status || '').toLowerCase();
  const resolvedTone = tone || STATUS_TONES[key] || 'slate';
  const text = label || LABEL_OVERRIDES[key] || humanize(status);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${TONE[resolvedTone]} ${className}`}
    >
      {text}
    </span>
  );
}
