/** Stage-filter shortcuts on /floor-pipeline/tickets — each maps to its RBAC section. */
import {
  canMoveDiagnosisToAssembly,
  canRunStageRoutingActions,
  isFloorManagerRole,
} from './floorPipelineUi';

export const FLOOR_TICKET_ASSIGN_SECTIONS = ['floor_tickets', 'floor_pipeline', 'tickets'];

export const FLOOR_TICKET_STAGE_RULES = [
  {
    match: (stage) => /QC1|QC2/i.test(stage || ''),
    sections: ['qc_management'],
  },
  {
    match: (stage) => stage === 'Chip Level Repair',
    sections: ['chip_level_repair'],
  },
  {
    match: (stage) => stage === 'Body & Paint',
    sections: ['floor_pipeline'],
  },
];

export const FLOOR_TICKETS_BASE_SECTIONS = [
  'floor_pipeline',
  'floor_tickets',
  'chip_level_repair',
  'qc_management',
];

export const FLOOR_DASHBOARD_SECTIONS = ['floor_pipeline'];

export function canAccessFloorStageFilter(stageFilter, canView) {
  if (!stageFilter) return true;
  const rule = FLOOR_TICKET_STAGE_RULES.find((r) => r.match(stageFilter));
  if (!rule) return true;
  return rule.sections.some((section) => canView(section));
}

export function firstAllowedFloorTicketsPath(canView) {
  if (canView('floor_tickets')) return '/floor-pipeline/tickets';
  if (canView('chip_level_repair')) return '/floor-pipeline/tickets?stage=Chip+Level+Repair';
  if (canView('qc_management')) return '/floor-pipeline/tickets?stage=QC1,QC2';
  if (canView('pending_inventory')) return '/floor-pipeline/pending-inventory';
  if (canView('floor_pipeline')) return '/floor-pipeline/dashboard';
  return null;
}

export function isFloorAssignedDataOnly(isAssignedDataOnly) {
  return FLOOR_TICKET_ASSIGN_SECTIONS.some((section) => isAssignedDataOnly(section));
}

export function hasFloorTicketEdit(canEdit) {
  return FLOOR_TICKET_ASSIGN_SECTIONS.some((section) => canEdit(section));
}

/** All-data scope + edit — manager-level control (assign, reassign, stage routing). */
export function canManageFloorTickets(canEdit, isAssignedDataOnly) {
  return hasFloorTicketEdit(canEdit) && !isFloorAssignedDataOnly(isAssignedDataOnly);
}

/** Edit laptop config (brand/model/RAM/SSD) on floor tickets — separate from assign/stage manager access. */
export function canEditFloorTicketConfig(canEdit) {
  return canEdit('floor_ticket_config_edit');
}

/** Assign / reassign — matches backend POST /tickets/:id/assign (floor_tickets edit). */
export function canAssignFloorTickets(canEdit, isAssignedDataOnly) {
  return canManageFloorTickets(canEdit, isAssignedDataOnly);
}

/** Keep user on ticket detail after workflow when they have all-data manager access. */
export function isFloorTicketPrivileged(user, canEdit, isAssignedDataOnly) {
  if (canManageFloorTickets(canEdit, isAssignedDataOnly)) return true;
  if (isFloorAssignedDataOnly(isAssignedDataOnly)) return false;
  return isFloorManagerRole(user?.role) || user?.role === 'super_admin';
}

export function canRunFloorStageRouting(user, canEdit, isAssignedDataOnly) {
  if (canManageFloorTickets(canEdit, isAssignedDataOnly)) return true;
  return canRunStageRoutingActions(user?.role);
}

export function canMoveDiagnosisToAssemblyForUser(user, canEdit, isAssignedDataOnly) {
  if (canManageFloorTickets(canEdit, isAssignedDataOnly)) return true;
  return canMoveDiagnosisToAssembly(user?.role);
}

/** Sidebar highlight — match stage query presets, not just pathname. */
export function isFloorPipelineNavActive(childPath, location) {
  const pathname = location.pathname || '';
  const stage = new URLSearchParams(location.search || '').get('stage') || '';

  if (childPath === '/floor-pipeline/tickets') {
    return pathname === '/floor-pipeline/tickets' && !stage;
  }
  if (childPath.startsWith('/floor-pipeline/tickets?')) {
    if (pathname !== '/floor-pipeline/tickets') return false;
    const childStage = new URLSearchParams(childPath.split('?')[1] || '').get('stage') || '';
    return stage === childStage;
  }
  if (childPath === '/floor-pipeline/diagnosis-failed') {
    return pathname === '/floor-pipeline/diagnosis-failed';
  }
  return pathname === childPath || pathname.startsWith(`${childPath}/`);
}
