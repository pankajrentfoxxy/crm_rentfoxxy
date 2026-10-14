// Mirrors services/loanLaptopService.js STATUS on the backend.
export const LOAN_STATUS = {
  requested: { label: 'Requested', tone: 'gray' },
  pending_approval: { label: 'Pending Approval', tone: 'amber' },
  approved: { label: 'Approved', tone: 'blue' },
  rejected: { label: 'Rejected', tone: 'red' },
  dc_generated: { label: 'Loan DC Generated', tone: 'blue' },
  dispatched: { label: 'Dispatched', tone: 'purple' },
  loan_active: { label: 'Loan Active', tone: 'green' },
  repair_completed: { label: 'Repair Completed', tone: 'green' },
  decision_pending: { label: 'Customer Decision Pending', tone: 'orange' },
  return_in_progress: { label: 'Loan Return In Progress', tone: 'purple' },
  returned: { label: 'Returned', tone: 'gray' },
  conversion_pending_approval: { label: 'Keep — Pending Accounts', tone: 'amber' },
  converted: { label: 'Converted to Active', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

export const QUEUE_TABS = [
  { key: '', label: 'All' },
  { key: 'pending_approval', label: 'Accounts Approval' },
  { key: 'ready_for_dc', label: 'Ready for Loan DC' },
  { key: 'in_transit', label: 'Out for Delivery' },
  { key: 'active', label: 'Active Loans' },
  { key: 'decision_pending', label: 'Decision Pending' },
  { key: 'closed', label: 'Closed' },
];

export const POLICY_DECISION = {
  allowed: { label: 'Allowed by policy', tone: 'green' },
  approval_required: { label: 'Accounts approval required', tone: 'amber' },
  not_allowed: { label: 'Not allowed', tone: 'red' },
};

export const CONFIRMATION_METHODS = [
  { value: 'phone_call', label: 'Phone call' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'written', label: 'Written / signed form' },
  { value: 'in_person', label: 'In person' },
  { value: 'customer_portal', label: 'Customer portal' },
];

export const DISPATCH_MODES = [
  { value: 'technician', label: 'Technician (by hand)' },
  { value: 'courier', label: 'Courier' },
  { value: 'porter', label: 'Porter' },
];

export function formatMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleString('en-IN', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

export function todayIst() {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
}

export function specLine(spec = {}) {
  return [spec.brand, spec.model, spec.processor, spec.generation, spec.ram, spec.storage]
    .filter(Boolean).join(' · ') || '—';
}
