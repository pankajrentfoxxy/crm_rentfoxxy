import { getBackendOrigin } from '../../utils/api';

export const formatTicketId = (id) => `#TKT-${String(id).padStart(3, '0')}`;
export const formatItemId = (id) => `ITEM-${String(id).padStart(2, '0')}`;

/** ERP migration: pickup marked done in CRM but warehouse never received the unit. */
export function isMigratedPickupStuck(pickup) {
  if (!pickup) return false;
  if (pickup.warehouse_received_at || pickup.reached_warehouse_at) return false;
  return ['resolved', 'inventory_updated', 'closed'].includes(pickup.status)
    || !!pickup.customer_otp_verified_at;
}

export function hasWarehouseReturnPickup(pickups = []) {
  return pickups.some((p) => p.item_type === 'pickup' && p.warehouse_received_at);
}

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

export const uploadBase = () => getBackendOrigin();

export const uploadAssetUrl = (path) => {
  if (!path) return null;
  if (String(path).startsWith('http')) return path;
  return `${getBackendOrigin().replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
};

export const podUrl = (path) => (
  path ? `${getBackendOrigin().replace(/\/$/, '')}/uploads/${String(path).replace(/^\/?uploads\//, '')}` : null
);

// Client-side image compression so large phone-camera photos (often 5-15 MB)
// are shrunk before upload and never trip the server's size limit. Resizes to a
// max edge and re-encodes as JPEG, stepping quality down until under maxBytes.
// Non-image files (e.g. PDF) and any failure fall back to the original file.
export const compressImageFile = async (file, opts = {}) => {
  const { maxDimension = 1600, quality = 0.7, maxBytes = 1.5 * 1024 * 1024 } = opts;
  if (!file || !file.type || !file.type.startsWith('image/')) return file;

  const readAsDataURL = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });

  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const canvasToBlob = (canvas, q) => new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', q);
  });

  try {
    const dataUrl = await readAsDataURL(file);
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    let q = quality;
    let blob = await canvasToBlob(canvas, q);
    while (blob && blob.size > maxBytes && q > 0.4) {
      q -= 0.1;
      // eslint-disable-next-line no-await-in-loop
      blob = await canvasToBlob(canvas, q);
    }
    if (!blob) return file;

    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
};

export const displayStatus = (ticket) => {
  if (ticket.status === 'closed') {
    const wasReplacement = !!(ticket.sales_order_number
      || (ticket.items || []).some((i) => i.item_type === 'replacement'));
    return {
      label: wasReplacement ? 'Completed' : 'Closed',
      className: 'closed',
    };
  }
  const awaitingServiceReturn = (ticket.items || []).some(
    (item) => item.item_type === 'pickup' && item.status === 'awaiting_service_return'
  );
  if (awaitingServiceReturn) {
    return { label: 'Awaiting service return', className: 'progress' };
  }
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
    const line1 = [value.address, value.line1, value.address_line_1, value.line2, value.landmark]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(', ');
    const cityState = [value.city, value.state].filter(Boolean).join(', ');
    const pin = value.pincode || value.pin || value.postal_code || value.postal;
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

const resolvePickupKind = (item) => item.pickup_type || (item.source_item_id ? 'repair' : 'return');

export const getItemStepperV3Pickup = (item) => {
  const es = item.effective_current_step || (item.assigned_to || item.pickup_assigned_to ? 'assigned' : 'unassigned');
  const isRepair = resolvePickupKind(item) === 'repair';

  const sharedIdx = {
    unassigned: 0,
    assigned: 0,
    pending_dispatch: 0,
    in_transit: 0,
    wait_72h: 0,
    pickup_action: 0,
    reached: 1,
    visited: 1,
    pod_uploaded: 2,
    fixed_pending_pod: 2,
    customer_otp: 3,
    picked_up: 3,
  };

  if (isRepair) {
    const steps = [
      { key: 'assigned', label: 'Assigned' },
      { key: 'reached', label: 'Reached' },
      { key: 'pod', label: 'POD Photo' },
      { key: 'customer_otp', label: 'Customer OTP' },
      { key: 'warehouse_confirmed', label: 'Warehouse' },
      { key: 'service_return', label: 'Send Back' },
      { key: 'closed', label: 'Done' },
    ];
    const idxMap = {
      ...sharedIdx,
      awaiting_service_return: 5,
      service_dc_pending: 5,
      warehouse_confirmed: 6,
      reached_warehouse: 4,
      inventory_updated: 6,
      resolved: 6,
      otp_verified: 6,
      closed: 6,
    };
    let currentIndex = idxMap[es] ?? 0;
    if (isClosed(item)) currentIndex = steps.length - 1;
    return { steps, currentIndex, completedThrough: Math.max(0, currentIndex - 1) };
  }

  const steps = [
    { key: 'assigned', label: 'Assigned' },
    { key: 'reached', label: 'Reached' },
    { key: 'pod', label: 'POD Photo' },
    { key: 'customer_otp', label: 'Customer OTP' },
    { key: 'warehouse_confirmed', label: 'Warehouse' },
    { key: 'closed', label: 'Done' },
  ];
  const idxMap = {
    ...sharedIdx,
    warehouse_confirmed: 4,
    reached_warehouse: 4,
    inventory_updated: 5,
    resolved: 5,
    otp_verified: 5,
    closed: 5,
  };
  let currentIndex = idxMap[es] ?? 0;
  if (isClosed(item)) currentIndex = steps.length - 1;
  return { steps, currentIndex, completedThrough: Math.max(0, currentIndex - 1) };
};

/** v3 complaint stepper driven by `effective_current_step` from API */
export const getItemStepperV3Complaint = (item) => {
  const es = item.effective_current_step || (item.assigned_to ? 'assigned' : 'unassigned');
  const steps = [
    { key: 'reached', label: 'Reached' },
    { key: 'verify', label: 'Verify' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'poc', label: 'Proof' },
    { key: 'otp', label: 'Customer OTP' },
    { key: 'closed', label: 'Closed' }
  ];
  const idxMap = {
    unassigned: 0,
    assigned: 0,
    verify_ttspl: 1,
    visited: 2,
    working: 2,
    replacement_required: 2,
    picked_up_for_repair: 3,
    fixed_pending_pod: 3,
    pod_uploaded: 4,
    otp_verified: 5
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

/** True when an item may receive assigned_to (technician visit handling only). */
export const itemAllowsTechnicianAssign = (item) => {
  if (!item) return true;
  const method = String(item.pickup_method || '').trim().toLowerCase();
  if (method === 'courier' || method === 'porter') return false;
  if (item.item_type === 'pickup' && item.status === 'pending_dispatch') return false;
  if (item.item_type === 'complaint' && item.visited_at) return false;
  return true;
};

/** Return pickup assignee can change before technician marks reached / OTP. */
export const isPickupAssignmentEditable = (item) => {
  if (!item || item.item_type !== 'pickup') return false;
  if (['resolved', 'closed', 'inventory_updated', 'cancelled'].includes(String(item.status || ''))) {
    return false;
  }
  if (item.visited_at || item.customer_otp_verified_at || item.warehouse_received_at) return false;
  if (item.technician_esign_at || item.picked_up_at) return false;
  const es = item.effective_current_step;
  if (es === 'pending_dispatch') return false;
  return !!(item.pickup_method || item.pickup_assigned_to || item.assigned_to);
};

export const ticketHasUnassignedTechnicianSlots = (ticket) => (
  (ticket?.items || []).some(
    (item) => itemAllowsTechnicianAssign(item)
      && !item.assigned_to
      && !['resolved', 'closed'].includes(item.status)
  )
);

/** Ticket-list assign: any open item without an owner, including pending pickups. */
export const ticketHasUnassignedAssigneeSlots = (ticket) => (
  (ticket?.items || []).some(
    (item) => !item.assigned_to
      && !['resolved', 'closed', 'cancelled'].includes(item.status)
  )
);

/** Lead can assign or reassign while the ticket is still open. */
export const ticketCanChangeAssignee = (ticket) => {
  if (!ticket || ['closed', 'cancelled'].includes(String(ticket.status || ''))) return false;
  const items = ticket.items || [];
  if (!items.length) return true;
  return items.some((item) => !['resolved', 'closed', 'cancelled'].includes(item.status));
};

export const assigneeOptionLabel = (person) => {
  if (!person) return '';
  if (person.assignee_kind === 'warehouse') return `${person.name} (Warehouse)`;
  if (person.assignee_kind === 'internal') return `${person.name} (Internal)`;
  return person.name;
};

export const isFieldTechnicianAssignee = (person) => person?.assignee_kind === 'technician';

export const resolveItemPickupKind = (item) => {
  if (!item || item.item_type !== 'pickup') return null;
  return item.pickup_type || (item.source_item_id ? 'repair' : 'return');
};

export const ticketPickupKind = (ticket) => {
  if (ticket?.pickup_kind) return ticket.pickup_kind;
  const kinds = [...new Set((ticket?.items || [])
    .filter((item) => item.item_type === 'pickup')
    .map(resolveItemPickupKind)
    .filter(Boolean))];
  if (!kinds.length) return null;
  if (kinds.length === 1) return kinds[0];
  return 'mixed';
};

export const pickupKindLabel = (kind) => {
  if (kind === 'repair') return 'Repair Pickup';
  if (kind === 'return') return 'Return Pickup';
  if (kind === 'mixed') return 'Mixed Pickup';
  return null;
};

export const ticketSubTypeLabel = (ticket) => {
  const kind = ticket?.pickup_kind || ticketPickupKind(ticket);
  if (kind === 'repair') return 'Repair';
  if (kind === 'return') return 'Return';
  if (kind === 'mixed') return 'Mixed';
  return null;
};
