import React from 'react';
import { StatusChip } from '../../../../components/carret';

/**
 * Carret Serve → Loan laptops: shared bits.
 *
 * The screens call the same /api/loan-laptops endpoints as the old pages
 * (features/loan-laptops/loanLaptopApi), so there is one loan workflow. Status
 * words follow services/loanLaptopService STATUS; each maps onto a document
 * status StatusChip already knows, so the chip keeps its tone + glyph + word.
 */
export const LOAN_STATUS = {
  requested: { label: 'Requested', chip: 'pending' },
  pending_approval: { label: 'Accounts approval', chip: 'pending_approval' },
  approved: { label: 'Approved — Loan DC next', chip: 'approved' },
  rejected: { label: 'Rejected', chip: 'rejected' },
  dc_generated: { label: 'Loan DC ready', chip: 'issued' },
  dispatched: { label: 'Out for delivery', chip: 'dispatched' },
  loan_active: { label: 'With customer', chip: 'active' },
  repair_completed: { label: 'Repair done', chip: 'completed' },
  decision_pending: { label: 'Customer decision', chip: 'pending' },
  return_in_progress: { label: 'Coming back', chip: 'dispatched' },
  returned: { label: 'Returned', chip: 'closed' },
  conversion_pending_approval: { label: 'Keeps it — Accounts approval', chip: 'pending_approval' },
  converted: { label: 'Kept — now rented', chip: 'completed' },
  cancelled: { label: 'Cancelled', chip: 'cancelled' },
};

export function LoanChip({ status }) {
  const s = LOAN_STATUS[status] || { label: String(status || '—').replace(/_/g, ' '), chip: 'pending' };
  return <StatusChip status={s.chip} label={s.label} />;
}

export const POLICY_DECISION = {
  allowed: { label: 'Allowed by policy', chip: 'approved' },
  approval_required: { label: 'Needs Accounts approval', chip: 'pending_approval' },
  not_allowed: { label: 'Not allowed', chip: 'rejected' },
};

export function PolicyChip({ decision }) {
  const d = POLICY_DECISION[decision] || { label: decision || '—', chip: 'pending' };
  return <StatusChip status={d.chip} label={d.label} />;
}

/** The backend's queues (loanLaptopService QUEUES); counts come from /counts. */
export const QUEUE_TABS = [
  { key: 'pending_approval', label: 'Accounts approval' },
  { key: 'ready_for_dc', label: 'Loan DC to raise' },
  { key: 'in_transit', label: 'Going out' },
  { key: 'active', label: 'With customers' },
  { key: 'decision_pending', label: 'Customer decision' },
  { key: 'closed', label: 'Closed' },
  { key: '', label: 'All' },
];

export const CONFIRMATION_METHODS = [
  { value: 'phone_call', label: 'Phone call' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'written', label: 'Written / signed form' },
  { value: 'in_person', label: 'In person' },
  { value: 'customer_portal', label: 'Customer portal' },
];

export const DC_PURPOSE_LABEL = {
  loan: 'Loan DC',
  loan_return: 'Loan return DC',
  service_return: 'Service DC (repaired laptop)',
};

export function specLine(spec = {}) {
  return [spec?.brand, spec?.model, spec?.processor, spec?.generation, spec?.ram, spec?.storage]
    .filter(Boolean).join(' · ') || '—';
}

export function todayIst() {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
}

/** The loan's flow, for FlowSteps. Rejected / cancelled show no flow. */
export function loanFlow(loan) {
  const main = [
    ['requested', 'Requested'],
    ...(loan.approval_required ? [['pending_approval', 'Accounts approval']] : []),
    ['approved', 'Approved'],
    ['dc_generated', 'Loan DC'],
    ['dispatched', 'Out for delivery'],
    ['loan_active', 'With customer'],
    ['decision_pending', 'Customer decision'],
  ];
  const kept = loan.customer_decision === 'keep_loan' || ['conversion_pending_approval', 'converted'].includes(loan.status);
  const end = kept
    ? [['conversion_pending_approval', 'Accounts approval'], ['converted', 'Kept — rented']]
    : [['return_in_progress', 'Coming back'], ['returned', 'Returned']];
  const all = [...main, ...end];
  const at = loan.status === 'repair_completed' ? 'decision_pending' : loan.status;
  const idx = all.findIndex(([k]) => k === at);
  return all.map(([key, label], i) => ({
    key,
    label,
    state: idx < 0 ? 'todo' : i < idx ? 'done' : i === idx ? (['returned', 'converted'].includes(at) ? 'done' : 'current') : 'todo',
  }));
}
