/** Phase 2 design tokens — aligned with vendorMgmtUi / spec */
export const FP_PRIMARY = '#2563EB';
export const FP_SUCCESS = '#16A34A';
export const FP_WARNING = '#D97706';
export const FP_DANGER = '#DC2626';

export const KANBAN_STAGES = [
  'Floor Manager',
  'Diagnosis',
  'Assembly & Software',
  'Final Testing',
  'Chip Level Repair',
  'Body & Paint',
  'QC1',
  'QC2',
  'Pending Inventory',
  'Dispatch QC',
  'Inventory'
];

/** Main production path — branch stages (chip / body paint) are not sequential steps. */
export const MAIN_STAGE_ORDER = [
  'Floor Manager',
  'Diagnosis',
  'Assembly & Software',
  'Final Testing',
  'QC1',
  'QC2',
  'Pending Inventory',
  'Dispatch QC',
  'Inventory',
];

export const BRANCH_STAGES = ['Chip Level Repair', 'Body & Paint'];

export const MAIN_HW_STAGES = ['Diagnosis', 'Assembly & Software', 'Final Testing'];

/**
 * Stage pill status for the ticket detail timeline.
 * completed = green, active = blue, incomplete = red (bypassed / not finished),
 * pending = grey (not yet reached).
 */
export function computeStageStatuses(currentStage, ticket = {}) {
  const statuses = Object.fromEntries(KANBAN_STAGES.map((s) => [s, 'pending']));
  const branchActive = BRANCH_STAGES.includes(currentStage);
  const diagnosisFailed = ticket.status === 'diagnosis_failed';
  const mainIdx = MAIN_STAGE_ORDER.indexOf(currentStage);

  const markBranchSideTrip = (stageName, flagKey) => {
    if (!ticket[flagKey]) {
      statuses[stageName] = 'pending';
      return;
    }
    if (currentStage === stageName) return;
    const atOrPastAssembly = mainIdx >= MAIN_STAGE_ORDER.indexOf('Assembly & Software');
    statuses[stageName] = atOrPastAssembly ? 'completed' : 'pending';
  };

  if (branchActive || diagnosisFailed) {
    statuses['Floor Manager'] = 'completed';
    MAIN_HW_STAGES.forEach((s) => {
      statuses[s] = 'incomplete';
    });
    BRANCH_STAGES.forEach((s) => {
      if (s !== currentStage) statuses[s] = 'pending';
    });
    if (branchActive) {
      statuses[currentStage] = 'active';
    } else if (diagnosisFailed) {
      statuses['Diagnosis'] = 'incomplete';
    }
    return statuses;
  }

  MAIN_STAGE_ORDER.forEach((stage, i) => {
    if (mainIdx === -1) return;
    if (stage === currentStage) {
      statuses[stage] = 'active';
    } else if (i < mainIdx) {
      statuses[stage] = 'completed';
    } else {
      statuses[stage] = 'pending';
    }
  });

  markBranchSideTrip('Body & Paint', 'body_paint_required');
  markBranchSideTrip('Chip Level Repair', 'chip_repair_required');

  return statuses;
}

export const STAGE_TIMELINE_STYLES = {
  completed: 'bg-emerald-100 text-emerald-800',
  active: 'bg-blue-600 text-white',
  incomplete: 'bg-red-100 text-red-800',
  pending: 'bg-slate-100 text-slate-500',
};

export const STAGE_GROUPS = [
  {
    label: 'FLOOR MANAGER',
    color: 'text-slate-500',
    stages: ['Floor Manager']
  },
  {
    label: 'HARDWARE & SOFTWARE',
    color: 'text-blue-600',
    stages: ['Diagnosis', 'Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint']
  },
  {
    label: 'QUALITY CONTROL',
    color: 'text-indigo-600',
    stages: ['QC1', 'QC2', 'Dispatch QC']
  },
  {
    label: 'COMPLETE',
    color: 'text-green-600',
    stages: ['Inventory']
  }
];

export function stageCategory(stageName) {
  if (stageName === 'Floor Manager') return 'Floor Manager';
  if (['QC1', 'QC2', 'Dispatch QC'].includes(stageName)) return 'QC Team';
  if (stageName === 'Inventory') return 'Complete';
  return 'Hardware & Software';
}

export function stageCategoryBadge(stageName) {
  const cat = stageCategory(stageName);
  if (cat === 'QC Team') return 'bg-indigo-100 text-indigo-800';
  if (cat === 'Floor Manager') return 'bg-slate-100 text-slate-700';
  if (cat === 'Complete') return 'bg-green-100 text-green-800';
  return 'bg-blue-100 text-blue-800';
}

export const STAGE_COLUMN_STYLE = {
  QC1: 'border-indigo-300 bg-indigo-50/40',
  QC2: 'border-indigo-300 bg-indigo-50/40',
  'Dispatch QC': 'border-orange-200 bg-orange-50',
  'Chip Level Repair': 'border-amber-300 bg-amber-50/40',
  'Body & Paint': 'border-pink-300 bg-pink-50/40',
  default: 'border-gray-100 bg-slate-50/50'
};

export function priorityBadge(priority) {
  if (priority === 'sales_order') {
    return { label: 'Sales Order', className: 'bg-red-100 text-red-800' };
  }
  if (priority === 'high') {
    return { label: 'High', className: 'bg-amber-100 text-amber-900' };
  }
  return { label: 'Normal', className: 'bg-slate-100 text-slate-700' };
}

/** TTSPL id for display — API may send ttspl_display; refurb data often stored TTSPL in machine_number */
export function resolveTicketTtspl(ticket) {
  const direct = ticket?.ttspl_display || ticket?.ttspl_id;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const machine = ticket?.machine_number;
  if (!machine) return null;
  const match = String(machine).match(/TTSPL\d+/i);
  if (match) return match[0].toUpperCase();
  const trimmed = String(machine).trim();
  return trimmed || null;
}

/** OEM / vendor serial — list & ticket detail only */
export function resolveTicketSerial(ticket) {
  const sn = ticket?.resolved_serial_number || ticket?.serial_number || ticket?.vsn_serial_number;
  if (sn != null && String(sn).trim()) return String(sn).trim();
  return null;
}

export function configSummary(ticket) {
  const firstValue = (...keys) => {
    for (const key of keys) {
      const value = ticket?.[key];
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
    return null;
  };

  const model = firstValue('model', 'model_name', 'new_model_name');
  const displaySize = firstValue('screen_size', 'new_screen_size', 'display_size');
  const processor = firstValue('processor', 'cpu', 'new_processor');
  const generation = firstValue('generation', 'cpu_generation', 'new_generation');
  const ram = firstValue('ram', 'new_ram');
  const storage = firstValue('storage', 'new_storage');
  const gpu = firstValue('gpu', 'graphics', 'new_gpu');
  const brand = firstValue('brand', 'brand_name');

  const parts = [
    model ? (brand ? `${brand} - ${model}` : model) : brand,
    displaySize ? `${displaySize}` : null,
    processor,
    generation,
    ram ? `${ram} RAM` : null,
    storage,
    gpu && gpu !== 'Integrated' ? gpu : null,
    firstValue('os', 'new_os') ? `OS: ${firstValue('os', 'new_os')}` : null
  ].filter(Boolean);
  return parts.join(' | ') || '—';
}

export function configBadges(ticket) {
  return [
    { label: 'Brand', value: ticket.brand },
    { label: 'Model', value: ticket.model_name || ticket.model },
    { label: 'CPU', value: ticket.processor },
    { label: 'Gen', value: ticket.generation },
    { label: 'RAM', value: ticket.ram },
    { label: 'Storage', value: ticket.storage },
    { label: 'GPU', value: ticket.gpu },
    { label: 'Screen', value: ticket.screen_size ? `${ticket.screen_size}"` : null },
    { label: 'OS', value: ticket.os },
    { label: 'Condition', value: ticket.condition },
  ].filter((b) => b.value);
}

export function ticketAgeDays(createdAt) {
  if (!createdAt) return '—';
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

export function isFloorManagerRole(role) {
  return ['admin', 'manager', 'floor_manager'].includes(role);
}

/** Diagnosis → Assembly & Software — admin / floor manager only (not technicians or warehouse). */
export function canMoveDiagnosisToAssembly(role) {
  return role === 'super_admin' || isFloorManagerRole(role);
}

export function isQcRole(role) {
  return role === 'qc';
}

export const DISPATCH_QC_TEAM_NAME = 'Dispatch QC Team';

export function isDispatchQcRole(role) {
  return role === 'dispatch_qc';
}

/** Dispatch QC role, Dispatch QC Team, or dispatch_qc permission (EDIT). */
export function canActAsDispatchQc(user, canEdit) {
  if (!user) return false;
  if (isDispatchQcRole(user.role)) return true;
  const names = user.team_names || [];
  if (names.some((n) => String(n).trim().toLowerCase() === DISPATCH_QC_TEAM_NAME.toLowerCase())) {
    return true;
  }
  if (typeof canEdit === 'function' && canEdit('dispatch_qc')) return true;
  return false;
}

export function isTechnicianRole(role) {
  return ['team_member', 'team_lead', 'technician'].includes(role);
}

export function ticketStatusLabel(status) {
  const map = {
    in_progress: 'In Progress',
    completed: 'Completed',
    failed: 'Failed',
    on_hold: 'On Hold',
    qc_failed_return_vendor: 'Return to Vendor',
    cancelled: 'Cancelled',
    diagnosis_failed: 'Diagnosis Failed',
    out_for_repair: 'Out for Repair',
  };
  return map[status] || String(status || '—').replace(/_/g, ' ');
}

export function ticketStatusBadgeClass(status) {
  if (status === 'diagnosis_failed') return 'bg-amber-100 text-amber-900';
  if (status === 'out_for_repair') return 'bg-purple-100 text-purple-900';
  if (status === 'qc_failed_return_vendor') return 'bg-red-100 text-red-800';
  if (status === 'completed') return 'bg-green-100 text-green-800';
  return 'bg-slate-100 text-slate-700';
}

/** Stage moves / repair routing in the sidebar — not for floor technicians. */
export function canRunStageRoutingActions(role) {
  return ['admin', 'super_admin', 'floor_manager', 'warehouse', 'manager'].includes(role);
}

export const EVENT_ICONS = {
  ticket_created: '🎫',
  stage_changed: '↔️',
  parts_used: '🔧',
  config_updated: '⚙️',
  qc_started: '🔍',
  qc1_failed: '❌',
  qc2_failed: '❌',
  qc2_passed: '✅',
  qc_passed: '✅',
  inventory_ready: '📦',
  inventory_created: '🏷️',
  received: '📥',
  sales_order_created: '🛒',
  delivery_challan_created: '🚚',
  returned: '↩️',
  support_ticket: '🎧',
  vendor_assigned: '👤',
  qc_failed_return_vendor: '🚚',
  diagnosis_failed: '⚠️',
  vendor_dc_generated: '📄',
  esign_completed: '✍️',
  dispatched_to_vendor: '🚚',
  returned_from_vendor: '↩️',
  vendor_return: '↩️',
  reentered_qc_process: '🔍',
  received_at_warehouse: '📥',
  chip_repair_started: '🔬',
  body_paint_started: '🎨',
  inventory_tagged: '🏷️',
  customer_asset_updated: '✏️',
  status_in_stock: '📦',
  status_reserved: '🔒',
  status_in_transit: '🚚',
  status_rented: '💼',
  status_on_demo: '🎯',
  status_sold: '💰',
  status_returned: '↩️',
  status_delivered: '✅',
  default: '•'
};
