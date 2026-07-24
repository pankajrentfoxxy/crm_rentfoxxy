const pool = require('../config/db');
const {
  getUserPermissionRow,
  getRolePermissionRow,
  hasPermission,
} = require('./permissionService');

const SO_VIEW_SECTIONS = [
  'sales_orders_doc',
  'sales_orders_sale',
  'sales_orders_rental',
  'sales_orders_replacement',
];

const SO_STANDARD_VIEW_SECTIONS = [
  'sales_orders_doc',
  'sales_orders_sale',
  'sales_orders_rental',
];

const DATA_SCOPE_ALL = 'all';
const DATA_SCOPE_ASSIGNED = 'assigned';

const SECTION_ALIASES = {
  reports_access: ['reports_access', 'reports'],
  reports: ['reports', 'reports_access'],
  follow_ups: ['follow_ups', 'lead_follow_ups'],
  lead_follow_ups: ['follow_ups', 'lead_follow_ups'],
  sales_orders: ['sales_orders', 'sales_orders_doc'],
  sales_orders_doc: ['sales_orders', 'sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental'],
  sales_orders_sale: ['sales_orders_sale', 'sales_orders_doc', 'sales_orders'],
  sales_orders_rental: ['sales_orders_rental', 'sales_orders_doc', 'sales_orders'],
  floor_pipeline: ['floor_pipeline', 'floor_tickets', 'tickets'],
  floor_tickets: ['floor_tickets', 'floor_pipeline', 'tickets'],
  tickets: ['tickets', 'floor_pipeline', 'floor_tickets'],
  chip_level_repair: ['chip_level_repair', 'floor_pipeline', 'tickets'],
  qc_management: ['qc_management', 'tickets'],
  dispatch: ['dispatch', 'delivery_challans'],
  delivery_challans: ['delivery_challans', 'dispatch'],
};

/** Map sales list entity_scope query to RBAC section for data_scope checks. */
function salesOrderScopeSection(entityScope) {
  const scope = String(entityScope || '').trim().toLowerCase();
  if (scope === 'sale') return 'sales_orders_sale';
  if (scope === 'rental') return 'sales_orders_rental';
  if (scope === 'replacement') return 'sales_orders_replacement';
  return 'sales_orders_doc';
}

/** Users with replacement SO access but no standard sale/rental/doc list access. */
async function userHasReplacementOnlySalesOrderAccess(userId, role, cache) {
  if (role === 'super_admin' || role === 'admin') return false;
  const hasReplacement = await hasPermission(userId, role, 'sales_orders_replacement', 'can_view', cache);
  if (!hasReplacement) return false;
  for (const section of SO_STANDARD_VIEW_SECTIONS) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasPermission(userId, role, section, 'can_view', cache)) return false;
  }
  return true;
}

async function assertReplacementSalesOrderAccessIfScoped(salesOrderNumber, user, cache) {
  if (!user || !salesOrderNumber) return;
  if (user.role === 'super_admin' || user.role === 'admin') return;
  const replacementOnly = await userHasReplacementOnlySalesOrderAccess(
    user.user_id,
    user.role,
    cache
  );
  if (!replacementOnly) return;
  const r = await pool.query(
    `SELECT 1 FROM support_replacement_orders
      WHERE sales_order_number = $1
      LIMIT 1`,
    [salesOrderNumber]
  );
  if (!r.rows.length) {
    const err = new Error('Access limited to replacement sales orders only');
    err.status = 403;
    throw err;
  }
}

async function resolveSalesOrderListOrderType(user, requestedOrderType, cache) {
  const replacementOnly = await userHasReplacementOnlySalesOrderAccess(
    user?.user_id,
    user?.role,
    cache
  );
  if (replacementOnly) return 'replacement';
  return String(requestedOrderType || '').trim().toLowerCase();
}

function sectionsToCheck(section) {
  return SECTION_ALIASES[section] || [section];
}

function scopeUserId(user) {
  const id = user?.user_id ?? user?.userId;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const QC_INSPECTOR_QUEUE_STAGES = new Set(['QC1', 'QC2', 'Dispatch QC']);

function isQcInspectorQueueStage(stageName) {
  return QC_INSPECTOR_QUEUE_STAGES.has(String(stageName || '').trim());
}

/** QC Inspector role lists the full QC queue — assignment filter is skipped in ticketController. */
function isQcInspectorRole(role) {
  return role === 'qc';
}

async function getEffectiveDataScope(userId, role, section, cache) {
  if (role === 'super_admin') return DATA_SCOPE_ALL;

  const keys = sectionsToCheck(section);

  // Pass 1: user overrides on any section alias win over role defaults.
  for (const key of keys) {
    const cacheKey = `${key}:scope`;
    if (cache && Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
      if (cache[cacheKey] === DATA_SCOPE_ASSIGNED) return DATA_SCOPE_ASSIGNED;
      if (cache[cacheKey] === DATA_SCOPE_ALL) return DATA_SCOPE_ALL;
      continue;
    }

    const userRow = await getUserPermissionRow(userId, key);
    if (userRow?.data_scope === DATA_SCOPE_ASSIGNED) {
      if (cache) cache[cacheKey] = DATA_SCOPE_ASSIGNED;
      return DATA_SCOPE_ASSIGNED;
    }
    if (userRow?.data_scope === DATA_SCOPE_ALL) {
      if (cache) cache[cacheKey] = DATA_SCOPE_ALL;
      return DATA_SCOPE_ALL;
    }
  }

  // Pass 2: inherit role default when no user override on any alias.
  for (const key of keys) {
    const cacheKey = `${key}:scope`;
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

/** True when user may view all sales orders (any sale/rental/doc section with data_scope=all). */
async function hasUnrestrictedSalesOrderAccess(userId, role, cache) {
  if (role === 'super_admin' || role === 'admin') return true;
  const sections = ['sales_orders_sale', 'sales_orders_rental', 'sales_orders_doc'];
  for (const section of sections) {
    // eslint-disable-next-line no-await-in-loop
    const canView = await hasPermission(userId, role, section, 'can_view', cache);
    if (!canView) continue;
    // eslint-disable-next-line no-await-in-loop
    const scope = await getEffectiveDataScope(userId, role, section, cache);
    if (scope === DATA_SCOPE_ALL) return true;
  }
  return false;
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

  if (isQcInspectorRole(req.user?.role) && isQcInspectorQueueStage(ticket.stage_name)) {
    return true;
  }

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
  SO_VIEW_SECTIONS,
  sectionsToCheck,
  scopeUserId,
  getEffectiveDataScope,
  isRestrictedToAssigned,
  isRestrictedToAssignedAny,
  salesOrderScopeSection,
  userHasReplacementOnlySalesOrderAccess,
  assertReplacementSalesOrderAccessIfScoped,
  resolveSalesOrderListOrderType,
  hasUnrestrictedSalesOrderAccess,
  resolveTicketListScope,
  buildTicketListAssignmentClause,
  canAccessTicketRecord,
  isQcInspectorRole,
  isQcInspectorQueueStage,
  appendCreatedByFilter,
  appendDeliveryPersonFilter,
  appendSupportAssignedFilter,
};
