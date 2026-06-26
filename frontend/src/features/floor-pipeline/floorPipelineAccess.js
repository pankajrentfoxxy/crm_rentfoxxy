/** Stage-filter shortcuts on /floor-pipeline/tickets — each maps to its RBAC section. */
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
  if (canView('floor_pipeline')) return '/floor-pipeline/dashboard';
  return null;
}
