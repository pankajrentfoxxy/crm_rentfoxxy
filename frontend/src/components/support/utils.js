export const formatTicketId = (id) => `#TKT-${String(id).padStart(3, '0')}`;
export const formatItemId = (id) => `ITEM-${String(id).padStart(2, '0')}`;

export const formatRelative = (date) => {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const formatUpdatedLabel = (hours) => {
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  if (h < 1) return 'Updated just now';
  return `Updated ${h}h ago`;
};

export const formatCreatedLabel = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatHours = (hours) => {
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  return `${h}h`;
};

export const uploadBase = () => {
  const host = window.location.hostname;
  if (host === 'localhost' || host.startsWith('192.168.')) {
    return `http://${host}:5001`;
  }
  return window.location.origin;
};

export const podUrl = (path) => (path ? `${uploadBase()}/uploads/${path}` : null);

export const displayStatus = (ticket) => {
  if (ticket.status === 'closed') return { label: 'Closed', className: 'closed' };
  if (ticket.has_replacement_pending) return { label: 'Replacement pending', className: 'replacement' };
  if (ticket.is_overdue) return { label: `Overdue · ${formatHours(ticket.hours_since_last_update)}`, className: 'overdue' };
  if (ticket.unassigned_item_count > 0) return { label: 'Unassigned', className: 'open' };
  if (ticket.status === 'in_progress') return { label: 'In progress', className: 'progress' };
  return { label: 'Open', className: 'open' };
};

export const isUrgentPickup = (items = []) => {
  const now = Date.now();
  for (const item of items) {
    if (item.item_type !== 'pickup' || !item.loan_delivered_at) continue;
    const delivered = new Date(item.loan_delivered_at).getTime();
    const windowEnd = delivered + 72 * 60 * 60 * 1000;
    const hoursToWindow = (windowEnd - now) / (60 * 60 * 1000);
    if (hoursToWindow > 0 && hoursToWindow <= 24) {
      return { urgent: true, hours: Math.ceil(hoursToWindow) };
    }
  }
  return { urgent: false, hours: 0 };
};

export const initials = (name) => {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
};

export const formatAddress = (value) => {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return '—';
    if (s.startsWith('{')) {
      try {
        return formatAddress(JSON.parse(s));
      } catch {
        return s;
      }
    }
    return s;
  }
  if (typeof value === 'object') {
    const line1 = [value.line1, value.line2, value.landmark].filter(Boolean).join(', ');
    const cityState = [value.city, value.state].filter(Boolean).join(', ');
    const pin = value.pincode || value.pin || value.postal_code;
    const mid = [line1, cityState].filter(Boolean).join(', ');
    if (pin) return mid ? `${mid} — ${pin}` : String(pin);
    return mid || '—';
  }
  return String(value);
};

export const workloadTone = (openItems) => {
  if (openItems >= 12) return 'high';
  if (openItems >= 6) return 'medium';
  return 'low';
};

const isClosed = (item) => ['resolved', 'closed', 'inventory_updated'].includes(item.status);

/** v3 complaint stepper driven by `effective_current_step` from API */
export const getItemStepperV3Complaint = (item) => {
  const es = item.effective_current_step || (item.assigned_to ? 'assigned' : 'unassigned');
  const steps = [
    { key: 'assigned', label: 'Assigned' },
    { key: 'visited', label: 'Visited' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'pod', label: 'POD' },
    { key: 'otp', label: 'Customer OTP' },
    { key: 'closed', label: 'Closed' }
  ];
  const idxMap = {
    unassigned: 0,
    assigned: 0,
    visited: 1,
    working: 2,
    replacement_required: 2,
    fixed_pending_pod: 3,
    pod_uploaded: 4,
    otp_verified: 5
  };
  let currentIndex = idxMap[es] ?? 0;
  if (isClosed(item)) currentIndex = steps.length - 1;
  return { steps, currentIndex, completedThrough: Math.max(0, currentIndex - 1) };
};

export const getItemStepperV3Pickup = (item) => {
  const es = item.effective_current_step || (item.assigned_to ? 'assigned' : 'unassigned');
  const steps = [
    { key: 'assigned', label: 'Assigned' },
    { key: 'pickup', label: 'Pickup' },
    { key: 'pod', label: 'POD' },
    { key: 'wh', label: 'Warehouse OTP' },
    { key: 'closed', label: 'Closed' }
  ];
  const idxMap = {
    unassigned: 0,
    assigned: 0,
    wait_72h: 0,
    pickup_action: 1,
    fixed_pending_pod: 2,
    pod_uploaded: 2,
    warehouse_otp: 3,
    otp_verified: 4
  };
  let currentIndex = idxMap[es] ?? 0;
  if (isClosed(item)) currentIndex = steps.length - 1;
  return { steps, currentIndex, completedThrough: Math.max(0, currentIndex - 1) };
};

export const getItemStepper = (item, replacementOrder) => {
  if (item.item_type === 'replacement') {
    const steps = [
      { key: 'flagged', label: 'Flagged' },
      { key: 'approved', label: 'Approved' },
      { key: 'placed', label: 'Order placed' },
      { key: 'dispatched', label: 'Dispatched' },
      { key: 'delivered', label: 'Delivered' },
      { key: 'inventory_updated', label: 'Inventory updated' },
      { key: 'closed', label: 'Closed' }
    ];
    const status = replacementOrder?.status || item.status;
    const order = ['flagged', 'approved', 'placed', 'dispatched', 'delivered', 'inventory_updated', 'closed'];
    const idx = Math.max(0, order.indexOf(status === 'order_placed' ? 'placed' : status));
    return { steps, currentIndex: isClosed(item) ? steps.length - 1 : idx, completedThrough: isClosed(item) ? steps.length - 1 : Math.max(0, idx - 1) };
  }

  if (item.item_type === 'pickup') {
    const steps = [
      { key: 'assigned', label: 'Assigned' },
      { key: 'loan', label: 'Loan delivered' },
      { key: 'wait', label: '72h wait' },
      { key: 'picked', label: 'Pickup done' },
      { key: 'pod', label: 'POD uploaded' },
      { key: 'otp', label: 'OTP verified' },
      { key: 'closed', label: 'Closed' }
    ];
    let current = 0;
    if (item.assigned_to) current = 1;
    if (item.loan_delivered_at) current = 2;
    if (item.loan_delivered_at) {
      const minPickup = new Date(item.loan_delivered_at).getTime() + 72 * 60 * 60 * 1000;
      if (Date.now() >= minPickup || item.picked_up_at) current = 3;
    }
    if (item.picked_up_at) current = 3;
    if (item.pod_image_path) current = 4;
    if (item.otp_verified_at) current = 5;
    if (isClosed(item)) current = 6;
    return { steps, currentIndex: current, completedThrough: Math.max(0, current - 1) };
  }

  const steps = [
    { key: 'assigned', label: 'Assigned' },
    { key: 'visited', label: 'Visited' },
    { key: 'work', label: 'Work done' },
    { key: 'pod', label: 'POD uploaded' },
    { key: 'otp', label: 'OTP verified' },
    { key: 'closed', label: 'Closed' }
  ];
  let current = 0;
  if (item.assigned_to) current = 1;
  if (item.visited_at || ['visited', 'work_done', 'awaiting_otp', 'resolved', 'closed'].includes(item.status)) current = 2;
  if (item.work_done_at || ['awaiting_otp', 'resolved', 'closed'].includes(item.status)) current = 3;
  if (item.pod_image_path) current = 4;
  if (item.otp_verified_at) current = 5;
  if (isClosed(item)) current = 6;
  return { steps, currentIndex: current, completedThrough: Math.max(0, current - 1) };
};

export const pickupMinScheduleDate = (loanDeliveredAt) => {
  if (!loanDeliveredAt) return null;
  return new Date(new Date(loanDeliveredAt).getTime() + 72 * 60 * 60 * 1000);
};

export const isLeadRole = (role) => role === 'admin' || role === 'support_lead';
