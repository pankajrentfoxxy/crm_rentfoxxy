'use strict';

const FIELD_WO_TYPES = [
  'FIELD_VISIT', 'REPAIR_PICKUP', 'RETURN_PICKUP', 'SERVICE_RETURN',
  'REPLACEMENT_DELIVERY', 'PART_DELIVERY', 'PART_RETURN',
];

const NOT_TERMINAL = `t.status NOT IN ('RESOLVED','CLOSED','CANCELLED')`;
const SLA_BREACHED = `${NOT_TERMINAL} AND t.sla_resolution_due_at IS NOT NULL AND t.sla_resolution_due_at < NOW()`;
const SLA_AT_RISK = `${NOT_TERMINAL} AND COALESCE(t.sla_paused, FALSE) = FALSE
  AND t.sla_resolution_due_at IS NOT NULL
  AND t.sla_resolution_due_at >= NOW()
  AND t.sla_resolution_due_at < NOW() + INTERVAL '4 hours'`;
const HAS_WO_TODAY = `EXISTS (
  SELECT 1 FROM support_work_orders w
   WHERE w.ticket_id = t.ticket_id
     AND w.wo_type IN ('${FIELD_WO_TYPES.join("','")}')
     AND (COALESCE(w.scheduled_start, w.created_at) AT TIME ZONE 'Asia/Kolkata')::date
         = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
)`;

const SYSTEM_VIEWS = {
  all_open: { status: 'OPEN' },
  breaching: { status: 'OPEN', sla: 'BREACHED_OR_AT_RISK' },
  unassigned: { status: 'OPEN', assigned_to: 'NONE' },
  mine: { status: 'OPEN', assigned_to: 'ME' },
  pending_customer: { status: 'PENDING', pending_reason: 'PENDING_CUSTOMER' },
  field_jobs_today: { has_wo_today: true },
  resolved_7d: { status: 'RESOLVED', resolved_within_days: 7 },
};

const SORTS = {
  priority_sla: `
    CASE WHEN t.sla_resolution_due_at < NOW() AND ${NOT_TERMINAL} THEN 0 ELSE 1 END,
    t.priority ASC,
    t.sla_resolution_due_at ASC NULLS LAST,
    t.created_at ASC`,
  sla: `t.sla_resolution_due_at ASC NULLS LAST, t.priority ASC, t.created_at ASC`,
  newest: `t.created_at DESC, t.ticket_id DESC`,
  age: `t.created_at ASC, t.ticket_id ASC`,
};

const LIST_SELECT = `
  t.ticket_id, t.ticket_number, t.priority, t.status, t.ticket_class, t.channel,
  t.customer_id, COALESCE(c.company_name, c.name) AS customer_name,
  t.site_label, c.support_tier,
  t.sla_resolution_due_at, t.sla_started_at, t.sla_paused, t.sla_breached,
  t.pending_reason, t.created_at, t.legacy_ticket_number,
  u.name AS assigned_to_name, t.assigned_to,
  (SELECT COUNT(*)::int FROM support_ticket_assets a WHERE a.ticket_id = t.ticket_id) AS asset_count,
  (SELECT COUNT(*)::int FROM support_work_orders w
    WHERE w.ticket_id = t.ticket_id
      AND w.status NOT IN ('COMPLETED','CANCELLED','FAILED')) AS open_wo_count,
  (SELECT a.ttspl_id FROM support_ticket_assets a
    WHERE a.ticket_id = t.ticket_id ORDER BY a.line_id LIMIT 1) AS primary_ttspl_id,
  (SELECT json_build_object('type', t1.name, 'subtype', t2.name, 'issue', t3.name)
     FROM support_ticket_assets a
     JOIN support_issue_catalog t3 ON t3.catalog_id = a.reported_issue_id
     JOIN support_issue_catalog t2 ON t2.catalog_id = a.reported_subtype_id
     JOIN support_issue_catalog t1 ON t1.catalog_id = a.reported_type_id
    WHERE a.ticket_id = t.ticket_id
    ORDER BY a.impact NULLS LAST, a.urgency NULLS LAST, a.line_id
    LIMIT 1) AS primary_classification,
  (SELECT COUNT(DISTINCT a.reported_subtype_id) > 1
     FROM support_ticket_assets a WHERE a.ticket_id = t.ticket_id) AS mixed_issues,
  json_build_object(
    'repeat', EXISTS (SELECT 1 FROM support_ticket_assets a WHERE a.ticket_id = t.ticket_id AND a.is_repeat),
    'safety', EXISTS (SELECT 1 FROM support_ticket_assets a WHERE a.ticket_id = t.ticket_id AND a.is_safety),
    'chargeable_pending', EXISTS (
      SELECT 1 FROM support_approvals ap
       WHERE ap.ticket_id = t.ticket_id AND ap.status = 'PENDING'
    ),
    'kb_suggested', false
  ) AS flags`;

/* impact/urgency used as a stand-in rank: lower impact = higher severity */
const FROM_JOIN = `
  FROM support_tickets_v2 t
  LEFT JOIN customers c ON c.customer_id = t.customer_id
  LEFT JOIN users u ON u.user_id = t.assigned_to`;

function applySla(conds, sla) {
  if (sla === 'BREACHED') conds.push(`(${SLA_BREACHED})`);
  else if (sla === 'AT_RISK') conds.push(`(${SLA_AT_RISK})`);
  else if (sla === 'BREACHED_OR_AT_RISK') conds.push(`((${SLA_BREACHED}) OR (${SLA_AT_RISK}))`);
  else if (sla === 'PAUSED') conds.push(`${NOT_TERMINAL} AND t.sla_paused = TRUE`);
  else if (sla === 'OK') {
    conds.push(`${NOT_TERMINAL} AND COALESCE(t.sla_paused, FALSE) = FALSE`);
    conds.push(`(t.sla_resolution_due_at IS NULL OR t.sla_resolution_due_at >= NOW() + INTERVAL '4 hours')`);
  }
}

function applyFilterBag(bag, userId, conds, params) {
  if (!bag || typeof bag !== 'object') return;

  const statuses = [].concat(bag.status || []).filter(Boolean);
  if (statuses.includes('OPEN')) conds.push(NOT_TERMINAL);
  else if (statuses.length) {
    params.push(statuses);
    conds.push(`t.status = ANY($${params.length}::text[])`);
  }

  if (bag.pending_reason) {
    params.push(bag.pending_reason);
    conds.push(`t.pending_reason = $${params.length}`);
  }

  let assigned = bag.assigned_to;
  if (assigned === 'ME') assigned = userId ? String(userId) : '';
  if (assigned === 'NONE') conds.push('t.assigned_to IS NULL');
  else if (assigned) {
    params.push(Number(assigned));
    conds.push(`t.assigned_to = $${params.length}`);
  }

  if (bag.sla) applySla(conds, bag.sla);
  if (bag.has_wo_today === true || bag.has_wo_today === 'true') conds.push(HAS_WO_TODAY);

  if (bag.resolved_within_days) {
    params.push(Number(bag.resolved_within_days));
    conds.push(`t.status = 'RESOLVED' AND t.resolved_at >= NOW() - ($${params.length} || ' days')::interval`);
  }

  if (bag.class) {
    params.push(bag.class);
    conds.push(`t.ticket_class = $${params.length}`);
  }
  if (bag.channel) {
    params.push(bag.channel);
    conds.push(`t.channel = $${params.length}`);
  }
  if (bag.customer_id) {
    params.push(Number(bag.customer_id));
    conds.push(`t.customer_id = $${params.length}`);
  }
  if (bag.group_id) {
    params.push(Number(bag.group_id));
    conds.push(`t.assignment_group_id = $${params.length}`);
  }

  const priorities = [].concat(bag.priority || []).map(Number).filter((n) => n >= 1 && n <= 4);
  if (priorities.length) {
    params.push(priorities);
    conds.push(`t.priority = ANY($${params.length}::int[])`);
  }

  if (bag.type_id || bag.subtype_id || bag.issue_id) {
    const bits = ['a.ticket_id = t.ticket_id'];
    if (bag.type_id) {
      params.push(Number(bag.type_id));
      bits.push(`a.reported_type_id = $${params.length}`);
    }
    if (bag.subtype_id) {
      params.push(Number(bag.subtype_id));
      bits.push(`a.reported_subtype_id = $${params.length}`);
    }
    if (bag.issue_id) {
      params.push(Number(bag.issue_id));
      bits.push(`a.reported_issue_id = $${params.length}`);
    }
    conds.push(`EXISTS (SELECT 1 FROM support_ticket_assets a WHERE ${bits.join(' AND ')})`);
  }

  if (bag.date_from) {
    params.push(bag.date_from);
    conds.push(`t.created_at >= $${params.length}::date`);
  }
  if (bag.date_to) {
    params.push(bag.date_to);
    conds.push(`t.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  if (bag.photos_deferred === true || bag.photos_deferred === 'true' || bag.photos_deferred === '1') {
    conds.push(`t.photos_deferred = TRUE`);
  }

  if (bag.search) {
    params.push(`%${String(bag.search).trim()}%`);
    const p = `$${params.length}`;
    conds.push(`(
      t.ticket_number ILIKE ${p}
      OR t.legacy_ticket_number ILIKE ${p}
      OR c.company_name ILIKE ${p}
      OR c.name ILIKE ${p}
      OR t.contact_phone ILIKE ${p}
      OR EXISTS (
        SELECT 1 FROM support_ticket_assets a
         WHERE a.ticket_id = t.ticket_id
           AND (a.ttspl_id ILIKE ${p} OR a.serial_number ILIKE ${p})
      )
    )`);
  }
}

function explicitFromQuery(q) {
  const bag = {};
  const keys = [
    'class', 'priority', 'status', 'pending_reason', 'type_id', 'subtype_id', 'issue_id',
    'sla', 'group_id', 'assigned_to', 'channel', 'customer_id', 'date_from', 'date_to',
    'search', 'has_wo_today', 'resolved_within_days', 'photos_deferred',
  ];
  for (const k of keys) {
    if (q[k] !== undefined && q[k] !== null && q[k] !== '') bag[k] = q[k];
  }
  return bag;
}

function buildTicketFilters({ viewFilters, query, userId }) {
  const conds = [];
  const params = [];
  applyFilterBag(viewFilters, userId, conds, params);
  applyFilterBag(explicitFromQuery(query || {}), userId, conds, params);
  return { conds, params, where: conds.length ? `WHERE ${conds.join(' AND ')}` : '' };
}

function sortSql(sort) {
  return SORTS[sort] || SORTS.priority_sla;
}

module.exports = {
  SYSTEM_VIEWS,
  LIST_SELECT,
  FROM_JOIN,
  NOT_TERMINAL,
  SLA_BREACHED,
  SLA_AT_RISK,
  HAS_WO_TODAY,
  FIELD_WO_TYPES,
  buildTicketFilters,
  sortSql,
  applyFilterBag,
};
