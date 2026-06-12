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
  'Inventory'
];

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
    stages: ['QC1', 'QC2']
  },
  {
    label: 'COMPLETE',
    color: 'text-green-600',
    stages: ['Inventory']
  }
];

export function stageCategory(stageName) {
  if (stageName === 'Floor Manager') return 'Floor Manager';
  if (['QC1', 'QC2'].includes(stageName)) return 'QC Team';
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

export function configSummary(ticket) {
  const parts = [
    ticket.brand,
    ticket.processor,
    ticket.ram ? `${ticket.ram} RAM` : null,
    ticket.storage
  ].filter(Boolean);
  return parts.join(' | ') || '—';
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

export function isQcRole(role) {
  return role === 'qc';
}

export function isTechnicianRole(role) {
  return role === 'technician';
}

export const EVENT_ICONS = {
  ticket_created: '🎫',
  stage_changed: '↔️',
  parts_used: '🔧',
  config_updated: '⚙️',
  qc1_failed: '❌',
  qc2_failed: '❌',
  qc2_passed: '✅',
  inventory_ready: '📦',
  qc_failed_return_vendor: '🚚',
  chip_repair_started: '🔬',
  body_paint_started: '🎨',
  inventory_tagged: '🏷️',
  default: '•'
};
