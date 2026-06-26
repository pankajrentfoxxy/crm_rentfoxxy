const {
  getUserPermissionRow,
  getRolePermissionRow,
} = require('./permissionService');

const DATA_SCOPE_ALL = 'all';
const DATA_SCOPE_ASSIGNED = 'assigned';

const SECTION_ALIASES = {
  reports_access: ['reports_access', 'reports'],
  reports: ['reports', 'reports_access'],
  follow_ups: ['follow_ups', 'lead_follow_ups'],
  lead_follow_ups: ['follow_ups', 'lead_follow_ups'],
  sales_orders: ['sales_orders', 'sales_orders_doc'],
  sales_orders_doc: ['sales_orders', 'sales_orders_doc'],
  floor_pipeline: ['floor_pipeline', 'floor_tickets', 'tickets'],
  floor_tickets: ['floor_tickets', 'floor_pipeline', 'tickets'],
  tickets: ['tickets', 'floor_pipeline', 'floor_tickets'],
  chip_level_repair: ['chip_level_repair', 'floor_pipeline', 'tickets'],
  qc_management: ['qc_management', 'tickets'],
  dispatch: ['dispatch', 'delivery_challans'],
  delivery_challans: ['delivery_challans', 'dispatch'],
};

function sectionsToCheck(section) {
  return SECTION_ALIASES[section] || [section];
}

function scopeUserId(user) {
  const id = user?.user_id ?? user?.userId;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getEffectiveDataScope(userId, role, section, cache) {
  if (role === 'super_admin') return DATA_SCOPE_ALL;

  for (const key of sectionsToCheck(section)) {
    const cacheKey = `${key}:scope`;
    if (cache && Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
      if (cache[cacheKey] === DATA_SCOPE_ASSIGNED) return DATA_SCOPE_ASSIGNED;
      continue;
    }

    const userRow = await getUserPermissionRow(userId, key);
    if (userRow?.data_scope === DATA_SCOPE_ASSIGNED) {
      if (cache) cache[cacheKey] = DATA_SCOPE_ASSIGNED;
      return DATA_SCOPE_ASSIGNED;
    }
    if (userRow?.data_scope === DATA_SCOPE_ALL) {
      if (cache) cache[cacheKey] = DATA_SCOPE_ALL;
      continue;
    }

    const roleRow = await getRolePermissionRow(role, key);
    const roleScope = roleRow?.data_scope === DATA_SCOPE_ASSIGNED
      ? DATA_SCOPE_ASSIGNED
      : DATA_SCOPE_ALL;
    if (cache) cache[cacheKey] = roleScope;
    if (roleScope === DATA_SCOPE_ASSIGNED) return DATA_SCOPE_ASSIGNED;
  }

  return DATA_SCOPE_ALL;
}

async function isRestrictedToAssigned(req, section) {
  if (!req?.user) return false;
  if (req.user.role === 'super_admin') return false;
  if (!req.dataScopeCache) req.dataScopeCache = {};
  const scope = await getEffectiveDataScope(
    req.user.user_id,
    req.user.role,
    section,
    req.dataScopeCache
  );
  return scope === DATA_SCOPE_ASSIGNED;
}

async function isRestrictedToAssignedAny(req, sections) {
  for (const section of sections) {
    if (await isRestrictedToAssigned(req, section)) return true;
  }
  return false;
}

async function resolveTicketListScope(req) {
  if (req.user?.role === 'super_admin') {
    return { mode: 'all' };
  }

  const assignedOnly = await isRestrictedToAssignedAny(req, [
    'tickets',
    'floor_pipeline',
    'floor_tickets',
    'chip_level_repair',
  ]);

  if (!assignedOnly) {
    return { mode: 'all' };
  }

  const userId = scopeUserId(req.user);
  const view = String(req.query?.view || '').toLowerCase();
  if (view === 'completed' && userId) {
    return { mode: 'assigned_or_worked', userId };
  }

  return { mode: 'assigned_strict', userId };
}

function buildTicketListAssignmentClause(scope, paramCount, params) {
  if (scope.mode === 'all') return { clause: '', paramCount };

  if (scope.mode === 'assigned_or_worked' && scope.userId) {
    params.push(scope.userId);
    const clause = ` AND (t.assigned_user_id = $${paramCount} OR EXISTS (
      SELECT 1 FROM activities a WHERE a.ticket_id = t.ticket_id AND a.user_id = $${paramCount}
        AND a.action IN ('stage_changed','stage_jumped')
    ))`;
    return { clause, paramCount: paramCount + 1 };
  }

  if (scope.mode === 'assigned_strict' && scope.userId) {
    params.push(scope.userId);
    return {
      clause: ` AND t.assigned_user_id IS NOT NULL AND t.assigned_user_id = $${paramCount}`,
      paramCount: paramCount + 1,
    };
  }

  return { clause: '', paramCount };
}

async function canAccessTicketRecord(req, ticket) {
  if (req.user?.role === 'super_admin') return true;

  const assignedOnly = await isRestrictedToAssignedAny(req, [
    'tickets',
    'floor_pipeline',
    'floor_tickets',
    'chip_level_repair',
  ]);

  if (!assignedOnly) return true;

  const userId = scopeUserId(req.user);
  if (!userId) return false;
  return Number(ticket.assigned_user_id) === userId;
}

function appendCreatedByFilter(alias, userId, params) {
  params.push(userId);
  const idx = params.length;
  return ` AND ${alias}.created_by = $${idx}`;
}

function appendDeliveryPersonFilter(userId, params) {
  params.push(userId);
  const idx = params.length;
  return ` AND d.delivery_person_id = $${idx}`;
}

function appendSupportAssignedFilter(userId, params) {
  params.push(userId);
  const idx = params.length;
  return ` AND EXISTS (
    SELECT 1 FROM support_ticket_items sti
    WHERE sti.ticket_id = t.id AND sti.assigned_to = $${idx}
  )`;
}

module.exports = {
  DATA_SCOPE_ALL,
  DATA_SCOPE_ASSIGNED,
  sectionsToCheck,
  scopeUserId,
  getEffectiveDataScope,
  isRestrictedToAssigned,
  isRestrictedToAssignedAny,
  resolveTicketListScope,
  buildTicketListAssignmentClause,
  canAccessTicketRecord,
  appendCreatedByFilter,
  appendDeliveryPersonFilter,
  appendSupportAssignedFilter,
};
