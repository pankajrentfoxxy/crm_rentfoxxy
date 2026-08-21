'use strict';
const pool = require('../config/db');
const { computeTicketStatus, logEvent } = require('../services/supportTicketStateService');
const {
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
} = require('../services/supportTicketQuery');

const OPEN_STATUSES = `('NEW','TRIAGED','ASSIGNED','IN_PROGRESS','PENDING')`;

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2:', e);
  return res.status(status).json({ success: false, message: e.message });
}

exports.health = async (_req, res) => res.json({ success: true, module: 'support-v2', phase: 11 });

exports.getBadges = async (req, res) => {
  try {
    const userId = req.user && req.user.user_id;
    const [open, unassigned, approvals, mine, partsPending] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM support_tickets_v2 WHERE status IN ${OPEN_STATUSES}`),
      pool.query(`SELECT COUNT(*)::int AS n FROM support_work_orders WHERE status IN ('DRAFT','PENDING_ASSIGNMENT')`),
      pool.query(`SELECT COUNT(*)::int AS n FROM support_approvals WHERE status = 'PENDING'`),
      userId
        ? pool.query(
          `SELECT COUNT(*)::int AS n FROM support_work_orders
            WHERE assigned_to = $1 AND status NOT IN ('COMPLETED','FAILED','CANCELLED')`,
          [userId]
        )
        : { rows: [{ n: 0 }] },
      pool.query(
        `SELECT COUNT(*)::int AS n FROM part_requests
          WHERE status_v2 IN ('REQUESTED','APPROVED','RESERVED','ESCALATED_TO_PROCUREMENT')`
      ).catch(() => ({ rows: [{ n: 0 }] })),
    ]);
    res.json({
      success: true,
      badges: {
        open_tickets: open.rows[0].n,
        unassigned_wos: unassigned.rows[0].n,
        parts_pending: partsPending.rows[0].n,
        approvals_pending: approvals.rows[0].n,
        my_jobs: mine.rows[0].n,
      },
    });
  } catch (e) {
    if (e.code === '42P01') {
      return res.json({
        success: true,
        badges: { open_tickets: 0, unassigned_wos: 0, parts_pending: 0, approvals_pending: 0, my_jobs: 0 },
      });
    }
    bad(res, e);
  }
};

async function resolveViewFilters(db, slug, userId) {
  if (!slug) return {};
  if (SYSTEM_VIEWS[slug]) return SYSTEM_VIEWS[slug];
  const r = await db.query(
    `SELECT filters FROM support_saved_views
      WHERE slug = $1 AND (is_system = TRUE OR owner_id = $2)
      LIMIT 1`,
    [slug, userId || null]
  );
  return r.rows[0] ? r.rows[0].filters : {};
}

exports.listTickets = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const viewFilters = await resolveViewFilters(pool, req.query.view, req.user && req.user.user_id);
    const { params, where } = buildTicketFilters({
      viewFilters,
      query: req.query,
      userId: req.user && req.user.user_id,
    });
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n ${FROM_JOIN} ${where}`,
      params
    );
    const total = count.rows[0].n;
    params.push(limit, offset);
    const rows = await pool.query(
      `SELECT ${LIST_SELECT}
         ${FROM_JOIN}
         ${where}
        ORDER BY ${sortSql(req.query.sort)}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({
      success: true,
      rows: rows.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (e) { bad(res, e); }
};

exports.getTicket = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const t = await pool.query(
      `SELECT t.*, COALESCE(c.company_name, c.name) AS customer_name, c.support_tier,
              u.name AS assigned_to_name, g.name AS assignment_group_name
         FROM support_tickets_v2 t
         LEFT JOIN customers c ON c.customer_id = t.customer_id
         LEFT JOIN users u ON u.user_id = t.assigned_to
         LEFT JOIN support_assignment_groups g ON g.group_id = t.assignment_group_id
        WHERE t.ticket_id = $1`,
      [id]
    );
    if (!t.rows[0]) return res.status(404).json({ success: false, message: 'Ticket not found' });

    const assets = await pool.query(
      `SELECT a.*,
              t1.code AS reported_type_code, t1.name AS reported_type_name,
              t2.code AS reported_subtype_code, t2.name AS reported_subtype_name,
              t3.code AS reported_issue_code, t3.name AS reported_issue_name,
              f1.code AS found_type_code, f1.name AS found_type_name,
              f2.code AS found_subtype_code, f2.name AS found_subtype_name,
              f3.code AS found_issue_code, f3.name AS found_issue_name,
              rc.name AS resolution_name, rcs.name AS root_cause_name
         FROM support_ticket_assets a
         JOIN support_issue_catalog t1 ON t1.catalog_id = a.reported_type_id
         JOIN support_issue_catalog t2 ON t2.catalog_id = a.reported_subtype_id
         JOIN support_issue_catalog t3 ON t3.catalog_id = a.reported_issue_id
         LEFT JOIN support_issue_catalog f1 ON f1.catalog_id = a.found_type_id
         LEFT JOIN support_issue_catalog f2 ON f2.catalog_id = a.found_subtype_id
         LEFT JOIN support_issue_catalog f3 ON f3.catalog_id = a.found_issue_id
         LEFT JOIN support_resolution_codes rc ON rc.code_id = a.resolution_code_id
         LEFT JOIN support_root_causes rcs ON rcs.cause_id = a.root_cause_id
        WHERE a.ticket_id = $1
        ORDER BY a.line_id`,
      [id]
    );
    const wos = await pool.query(
      `SELECT w.*, u.name AS assigned_to_name
         FROM support_work_orders w
         LEFT JOIN users u ON u.user_id = w.assigned_to
        WHERE w.ticket_id = $1
        ORDER BY w.wo_id`,
      [id]
    );
    const woIds = wos.rows.map((w) => w.wo_id);
    const steps = woIds.length
      ? (await pool.query(
        `SELECT * FROM support_work_order_steps WHERE wo_id = ANY($1::int[]) ORDER BY sort_order`,
        [woIds]
      )).rows
      : [];
    const woAssets = woIds.length
      ? (await pool.query(
        `SELECT * FROM support_work_order_assets WHERE wo_id = ANY($1::int[])`,
        [woIds]
      )).rows
      : [];
    const stepsByWo = new Map();
    for (const s of steps) {
      if (!stepsByWo.has(s.wo_id)) stepsByWo.set(s.wo_id, []);
      stepsByWo.get(s.wo_id).push(s);
    }
    const wosByLine = new Map();
    for (const w of wos.rows) {
      const packed = { ...w, steps: stepsByWo.get(w.wo_id) || [] };
      const lineIds = woAssets.filter((l) => l.wo_id === w.wo_id).map((l) => l.line_id);
      if (!lineIds.length) {
        if (!wosByLine.has(null)) wosByLine.set(null, []);
        wosByLine.get(null).push(packed);
      }
      for (const lineId of lineIds) {
        if (!wosByLine.has(lineId)) wosByLine.set(lineId, []);
        wosByLine.get(lineId).push(packed);
      }
    }

    const [events, attachments, approvals, extra, holds, links, replacements] = await Promise.all([
      pool.query(
        `SELECT e.*, u.name AS actor_name
           FROM support_ticket_events e
           LEFT JOIN users u ON u.user_id = e.actor_id
          WHERE e.ticket_id = $1
          ORDER BY e.created_at DESC, e.event_id DESC`,
        [id]
      ),
      pool.query('SELECT * FROM support_attachments WHERE ticket_id = $1 ORDER BY attachment_id', [id]),
      pool.query('SELECT * FROM support_approvals WHERE ticket_id = $1 ORDER BY approval_id', [id]),
      pool.query(
        `SELECT COALESCE(SUM(amount),0)::numeric AS chargeable_total,
                COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_lines
           FROM customer_invoice_extra_lines WHERE ticket_id = $1`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS open_holds FROM asset_billing_holds WHERE ticket_id = $1 AND hold_to IS NULL`,
        [id]
      ),
      pool.query(
        `SELECT l.*, t.ticket_number AS to_ticket_number
           FROM support_ticket_links l
           JOIN support_tickets_v2 t ON t.ticket_id = l.to_ticket_id
          WHERE l.from_ticket_id = $1
          ORDER BY l.link_id`,
        [id]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT * FROM support_replacements WHERE ticket_id = $1 ORDER BY replacement_id`,
        [id]
      ).catch(() => ({ rows: [] })),
    ]);

    res.json({
      success: true,
      ticket: t.rows[0],
      asset_lines: assets.rows.map((a) => ({
        ...a,
        work_orders: wosByLine.get(a.line_id) || [],
      })),
      events: events.rows,
      attachments: attachments.rows,
      approvals: approvals.rows,
      links: links.rows,
      replacements: replacements.rows,
      waiting_for_part: assets.rows.filter((a) => a.line_status === 'PENDING_PART').length,
      asset_line_count: assets.rows.length,
      costs: {
        chargeable_total: extra.rows[0].chargeable_total,
        pending_lines: extra.rows[0].pending_lines,
        open_holds: holds.rows[0].open_holds,
      },
    });
  } catch (e) { bad(res, e); }
};

exports.listWorkOrders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const conds = [];
    const params = [];
    if (req.query.status) {
      params.push(req.query.status);
      conds.push(`w.status = $${params.length}`);
    }
    if (req.query.wo_type) {
      params.push(req.query.wo_type);
      conds.push(`w.wo_type = $${params.length}`);
    }
    if (req.query.assigned_to === 'ME') {
      params.push(req.user.user_id);
      conds.push(`w.assigned_to = $${params.length}`);
    } else if (req.query.assigned_to === 'NONE') {
      conds.push('w.assigned_to IS NULL');
    } else if (req.query.assigned_to) {
      params.push(Number(req.query.assigned_to));
      conds.push(`w.assigned_to = $${params.length}`);
    }
    if (req.query.ticket_id) {
      params.push(Number(req.query.ticket_id));
      conds.push(`w.ticket_id = $${params.length}`);
    }
    const { applyTechnicianTicketScope, isFieldTechnician } = require('../services/supportTicketScope');
    applyTechnicianTicketScope(req.user, conds, params, 't');
    if (isFieldTechnician(req.user) && req.query.assigned_to !== 'ME') {
      params.push(req.user.user_id);
      conds.push(`w.assigned_to = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      conds.push(`(
        w.wo_number ILIKE $${params.length}
        OR t.ticket_number ILIKE $${params.length}
        OR COALESCE(c.company_name, c.name) ILIKE $${params.length}
        OR w.document_number ILIKE $${params.length}
        OR w.courier_awb ILIKE $${params.length}
        OR EXISTS (
          SELECT 1 FROM support_work_order_assets lq
          JOIN support_ticket_assets aq ON aq.line_id = lq.line_id
          WHERE lq.wo_id = w.wo_id
            AND (aq.ttspl_id ILIKE $${params.length} OR aq.serial_number ILIKE $${params.length})
        )
      )`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const from = `FROM support_work_orders w
         JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
         LEFT JOIN customers c ON c.customer_id = t.customer_id
         LEFT JOIN users u ON u.user_id = w.assigned_to`;
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n ${from} ${where}`,
      params
    );
    params.push(limit, offset);
    const { serializeWorkOrder } = require('../services/supportWoSerialize');
    const rows = await pool.query(
      `SELECT w.*, t.ticket_number, t.priority, t.customer_id,
              COALESCE(c.company_name, c.name) AS customer_name,
              u.name AS assigned_to_name
         ${from}
         ${where}
        ORDER BY w.created_at ASC, w.wo_id ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const woIds = rows.rows.map((r) => r.wo_id);
    let assetsByWo = {};
    if (woIds.length) {
      const ast = await pool.query(
        `SELECT l.wo_id, a.ttspl_id, a.serial_number, a.line_id
           FROM support_work_order_assets l
           JOIN support_ticket_assets a ON a.line_id = l.line_id
          WHERE l.wo_id = ANY($1)`,
        [woIds]
      );
      for (const a of ast.rows) {
        (assetsByWo[a.wo_id] || (assetsByWo[a.wo_id] = [])).push(a);
      }
    }
    res.json({
      success: true,
      rows: rows.rows.map((r) => ({
        ...serializeWorkOrder(r),
        ticket_number: r.ticket_number,
        customer_name: r.customer_name,
        assigned_to_name: r.assigned_to_name,
        assets: assetsByWo[r.wo_id] || [],
      })),
      pagination: {
        page,
        limit,
        total: count.rows[0].n,
        totalPages: Math.max(1, Math.ceil(count.rows[0].n / limit)),
      },
    });
  } catch (e) { bad(res, e); }
};

exports.listEvents = async (req, res) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const exists = await pool.query('SELECT ticket_id FROM support_tickets_v2 WHERE ticket_id = $1', [ticketId]);
    if (!exists.rows[0]) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const r = await pool.query(
      `SELECT e.*, u.name AS actor_name
         FROM support_ticket_events e
         LEFT JOIN users u ON u.user_id = e.actor_id
        WHERE e.ticket_id = $1
        ORDER BY e.created_at ASC, e.event_id ASC`,
      [ticketId]
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.listViews = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT view_id, name, slug, owner_id, is_system, filters, sort_order
         FROM support_saved_views
        WHERE is_system = TRUE OR owner_id = $1
        ORDER BY is_system DESC, sort_order ASC, name ASC`,
      [req.user.user_id]
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.createView = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    const slug = String(req.body.slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60) || `view_${Date.now()}`;
    const filters = req.body.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    const existing = await pool.query(
      `SELECT view_id FROM support_saved_views WHERE owner_id = $1 AND slug = $2`,
      [req.user.user_id, slug]
    );
    const r = existing.rows[0]
      ? await pool.query(
        `UPDATE support_saved_views SET name = $2, filters = $3 WHERE view_id = $1 RETURNING *`,
        [existing.rows[0].view_id, name, JSON.stringify(filters)]
      )
      : await pool.query(
        `INSERT INTO support_saved_views (name, slug, owner_id, is_system, filters, sort_order)
         VALUES ($1,$2,$3,FALSE,$4,100) RETURNING *`,
        [name, slug, req.user.user_id, JSON.stringify(filters)]
      );
    res.json({ success: true, view: r.rows[0] });
  } catch (e) { bad(res, e); }
};

exports.deleteView = async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM support_saved_views
        WHERE view_id = $1 AND owner_id = $2 AND is_system = FALSE
        RETURNING view_id`,
      [Number(req.params.id), req.user.user_id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'View not found' });
    res.json({ success: true });
  } catch (e) { bad(res, e); }
};

exports.ticketCounts = async (req, res) => {
  try {
    const userId = req.user && req.user.user_id;
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ${NOT_TERMINAL}) AS all_open,
         COUNT(*) FILTER (WHERE (${SLA_BREACHED}) OR (${SLA_AT_RISK})) AS breaching,
         COUNT(*) FILTER (WHERE ${NOT_TERMINAL} AND t.assigned_to IS NULL) AS unassigned,
         COUNT(*) FILTER (WHERE ${NOT_TERMINAL} AND t.assigned_to = $1) AS mine,
         COUNT(*) FILTER (WHERE t.status = 'PENDING' AND t.pending_reason = 'PENDING_CUSTOMER') AS pending_customer,
         COUNT(*) FILTER (WHERE ${HAS_WO_TODAY}) AS field_jobs_today,
         COUNT(*) FILTER (WHERE t.status = 'RESOLVED' AND t.resolved_at >= NOW() - INTERVAL '7 days') AS resolved_7d
         FROM support_tickets_v2 t`,
      [userId || 0]
    );
    const row = r.rows[0] || {};
    const counts = {};
    for (const k of Object.keys(row)) counts[k] = Number(row[k] || 0);
    res.json({ success: true, counts });
  } catch (e) { bad(res, e); }
};

exports.queueMeta = async (req, res) => {
  try {
    const [types, groups, owners] = await Promise.all([
      pool.query(
        `SELECT catalog_id, parent_id, level, code, name
           FROM support_issue_catalog
          WHERE active = TRUE
          ORDER BY level, sort_order, name`
      ),
      pool.query(
        `SELECT group_id, name, display_name, group_type, zone_id, sort_order
           FROM support_assignment_groups
          WHERE is_active = TRUE
          ORDER BY sort_order, name`
      ),
      pool.query(
        `SELECT DISTINCT u.user_id, u.name
           FROM users u
          WHERE COALESCE(u.active, TRUE) = TRUE
            AND (
              u.role IN ('support_tech', 'technician', 'support_lead', 'support_manager', 'support_agent')
              OR EXISTS (
                SELECT 1 FROM user_permissions up
                 WHERE up.user_id = u.user_id
                   AND up.section = 'support_bucket'
                   AND COALESCE(up.can_edit, FALSE) = TRUE
              )
              OR EXISTS (
                SELECT 1
                  FROM support_group_members m
                  JOIN support_assignment_groups g ON g.group_id = m.group_id
                 WHERE m.user_id = u.user_id
                   AND g.is_active = TRUE
                   AND g.group_type IN ('FIELD', 'REMOTE')
              )
            )
          ORDER BY u.name`
      ),
    ]);
    res.json({
      success: true,
      catalog: types.rows,
      groups: groups.rows,
      owners: owners.rows,
    });
  } catch (e) { bad(res, e); }
};

exports.bulkAssign = async (req, res) => {
  try {
    const ids = (req.body.ticket_ids || []).map(Number).filter(Boolean);
    const userId = req.body.user_id ? Number(req.body.user_id) : null;
    const groupId = req.body.group_id ? Number(req.body.group_id) : null;
    if (!ids.length) return res.status(400).json({ success: false, message: 'ticket_ids required' });
    if (!userId && !groupId) {
      return res.status(400).json({ success: false, message: 'user_id or group_id required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const id of ids) {
        await client.query(
          `UPDATE support_tickets_v2
              SET assigned_to = COALESCE($2, assigned_to),
                  assignment_group_id = COALESCE($3, assignment_group_id),
                  updated_at = NOW()
            WHERE ticket_id = $1`,
          [id, userId, groupId]
        );
        await logEvent(client, {
          ticketId: id,
          eventType: 'TICKET_ASSIGNED',
          actorId: req.user.user_id,
          summary: 'Bulk assigned from queue',
          detail: { assigned_to: userId, assignment_group_id: groupId },
        });
        await computeTicketStatus(client, id);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true, updated: ids.length });
  } catch (e) { bad(res, e); }
};

exports.dashboard = async (req, res) => {
  try {
    const kpis = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ${NOT_TERMINAL} AND t.sla_resolution_due_at IS NOT NULL
           AND t.sla_resolution_due_at < NOW() + INTERVAL '4 hours') AS breaching_4h,
         COUNT(*) FILTER (WHERE ${NOT_TERMINAL} AND t.priority = 1
           AND t.sla_resolution_due_at IS NOT NULL
           AND t.sla_resolution_due_at < NOW() + INTERVAL '4 hours') AS breaching_4h_p1,
         COUNT(*) FILTER (WHERE ${NOT_TERMINAL} AND t.assigned_to IS NULL) AS unassigned,
         COUNT(*) FILTER (WHERE ${NOT_TERMINAL}) AS open,
         COUNT(*) FILTER (WHERE ${NOT_TERMINAL} AND t.created_at >= NOW() - INTERVAL '1 day') AS open_delta,
         COUNT(*) FILTER (WHERE t.sla_resolution_breached = TRUE
           AND COALESCE(t.resolved_at, t.closed_at, t.updated_at) >= date_trunc('month', NOW())) AS breaches_mtd
         FROM support_tickets_v2 t`
    );
    const slaMtd = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE t.status IN ('RESOLVED','CLOSED')
           AND COALESCE(t.resolved_at, t.closed_at) >= date_trunc('month', NOW())) AS done,
         COUNT(*) FILTER (WHERE t.status IN ('RESOLVED','CLOSED')
           AND COALESCE(t.resolved_at, t.closed_at) >= date_trunc('month', NOW())
           AND COALESCE(t.sla_resolution_breached, FALSE) = FALSE) AS met
         FROM support_tickets_v2 t`
    );
    const mix = await pool.query(
      `SELECT priority, COUNT(*)::int AS n
         FROM support_tickets_v2
        WHERE ${NOT_TERMINAL.replace(/t\./g, '')}
        GROUP BY priority`
    );
    const unassignedField = await pool.query(
      `SELECT COUNT(*)::int AS n FROM support_work_orders
        WHERE assigned_to IS NULL
          AND status IN ('DRAFT','PENDING_ASSIGNMENT')
          AND wo_type = ANY($1::text[])`,
      [FIELD_WO_TYPES]
    );

    const riskFilters = buildTicketFilters({
      viewFilters: SYSTEM_VIEWS.breaching,
      query: {},
      userId: req.user && req.user.user_id,
    });
    const slaRisk = await pool.query(
      `SELECT ${LIST_SELECT} ${FROM_JOIN} ${riskFilters.where}
        ORDER BY ${sortSql('priority_sla')}
        LIMIT 5`,
      riskFilters.params
    );

    const waiting = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE pending_reason = 'PENDING_CUSTOMER') AS pending_customer,
         COUNT(*) FILTER (WHERE pending_reason = 'PENDING_PART') AS pending_part,
         COUNT(*) FILTER (WHERE pending_reason = 'PENDING_VENDOR') AS pending_vendor,
         COUNT(*) FILTER (WHERE pending_reason = 'PENDING_APPROVAL') AS pending_approval
         FROM support_tickets_v2
        WHERE status = 'PENDING'`
    );

    const capacity = await pool.query(
      `SELECT u.user_id, u.name,
              MAX(z.name) AS zone,
              COALESCE(array_agg(DISTINCT sk.code) FILTER (WHERE sk.code IS NOT NULL), '{}') AS skills,
              (
                SELECT COUNT(*)::int FROM support_work_orders w
                 WHERE w.assigned_to = u.user_id
                   AND w.status NOT IN ('COMPLETED','CANCELLED','FAILED')
                   AND (COALESCE(w.scheduled_start, w.created_at) AT TIME ZONE 'Asia/Kolkata')::date
                       = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
              ) AS jobs_today,
              COALESCE(MAX(s.max_jobs_per_day), 6) AS max_jobs,
              EXISTS (
                SELECT 1 FROM user_leaves l
                 WHERE l.user_id = u.user_id
                   AND l.leave_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
              ) AS on_leave
         FROM users u
         JOIN support_group_members gm ON gm.user_id = u.user_id
         JOIN support_assignment_groups g ON g.group_id = gm.group_id AND g.group_type = 'FIELD'
         LEFT JOIN support_zones z ON z.zone_id = g.zone_id
         LEFT JOIN user_skills us ON us.user_id = u.user_id
         LEFT JOIN support_skills sk ON sk.skill_id = us.skill_id
         LEFT JOIN user_shifts s ON s.user_id = u.user_id
        WHERE COALESCE(u.active, TRUE) = TRUE
        GROUP BY u.user_id, u.name
        ORDER BY on_leave, jobs_today DESC, u.name`
    );

    const quality = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM support_ticket_events
           WHERE event_type IN ('TICKET_REOPENED','REOPENED')
             AND created_at >= NOW() - INTERVAL '7 days') AS reopened_week,
         (SELECT COUNT(*)::int FROM support_ticket_events
           WHERE event_type IN ('TICKET_REOPENED','REOPENED')
             AND created_at >= NOW() - INTERVAL '14 days'
             AND created_at < NOW() - INTERVAL '7 days') AS reopened_prev,
         (SELECT COUNT(*)::int FROM support_tickets_v2 t
           WHERE t.status IN ('RESOLVED','CLOSED')
             AND COALESCE(t.resolved_at, t.closed_at) >= NOW() - INTERVAL '30 days') AS resolved_30,
         (SELECT COUNT(*)::int FROM support_tickets_v2 t
           WHERE t.status IN ('RESOLVED','CLOSED')
             AND COALESCE(t.resolved_at, t.closed_at) >= NOW() - INTERVAL '30 days'
             AND (SELECT COUNT(*) FROM support_work_orders w
                   WHERE w.ticket_id = t.ticket_id AND w.status = 'COMPLETED') = 1
             AND NOT EXISTS (
               SELECT 1 FROM support_ticket_events e
                WHERE e.ticket_id = t.ticket_id
                  AND e.event_type IN ('TICKET_REOPENED','REOPENED')
             )) AS fcr_30,
         (SELECT ROUND(AVG(csat_score)::numeric, 1)
            FROM support_tickets_v2
           WHERE csat_responded_at >= NOW() - INTERVAL '30 days'
             AND csat_score IS NOT NULL) AS csat_30d,
         (SELECT COUNT(DISTINCT COALESCE(serial_id::text, serial_number))::int
            FROM support_ticket_assets
           WHERE is_repeat = TRUE) AS repeat_assets`
    );

    const pinned = await pool.query(
      `SELECT ${LIST_SELECT} ${FROM_JOIN}
        WHERE t.dashboard_pinned = TRUE
           OR COALESCE(t.escalation_level, 0) >= 5
        ORDER BY t.escalation_level DESC, t.sla_resolution_due_at ASC NULLS LAST
        LIMIT 8`
    );

    const approvals = await pool.query(
      `SELECT a.approval_id, a.approval_type, a.amount, a.label, a.status,
              COALESCE(c.company_name, c.name) AS customer_name
         FROM support_approvals a
         LEFT JOIN support_tickets_v2 t ON t.ticket_id = a.ticket_id
         LEFT JOIN customers c ON c.customer_id = t.customer_id
        WHERE a.status = 'PENDING'
        ORDER BY a.created_at ASC
        LIMIT 8`
    );

    const k = kpis.rows[0] || {};
    const done = Number(slaMtd.rows[0]?.done || 0);
    const met = Number(slaMtd.rows[0]?.met || 0);
    const q = quality.rows[0] || {};
    const priority_mix = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const row of mix.rows) priority_mix[String(row.priority)] = row.n;

    res.json({
      success: true,
      kpis: {
        breaching_4h: Number(k.breaching_4h || 0),
        breaching_4h_p1: Number(k.breaching_4h_p1 || 0),
        unassigned: Number(k.unassigned || 0),
        unassigned_field: unassignedField.rows[0].n,
        open: Number(k.open || 0),
        open_delta: Number(k.open_delta || 0),
        sla_mtd_pct: done ? Math.round((met / done) * 1000) / 10 : 100,
        sla_target_pct: 95,
        breaches_mtd: Number(k.breaches_mtd || 0),
      },
      pinned: pinned.rows,
      sla_risk: slaRisk.rows,
      priority_mix,
      capacity: capacity.rows.map((r) => ({
        ...r,
        over: !r.on_leave && r.jobs_today > r.max_jobs,
      })),
      waiting: {
        PENDING_CUSTOMER: Number(waiting.rows[0].pending_customer || 0),
        PENDING_PART: Number(waiting.rows[0].pending_part || 0),
        PENDING_VENDOR: Number(waiting.rows[0].pending_vendor || 0),
        PENDING_APPROVAL: Number(waiting.rows[0].pending_approval || 0),
      },
      quality: {
        reopened_week: Number(q.reopened_week || 0),
        reopened_delta: Number(q.reopened_week || 0) - Number(q.reopened_prev || 0),
        fcr_pct: Number(q.resolved_30 || 0)
          ? Math.round((Number(q.fcr_30 || 0) / Number(q.resolved_30)) * 100)
          : 0,
        csat_30d: q.csat_30d == null ? null : Number(q.csat_30d),
        repeat_assets: Number(q.repeat_assets || 0),
      },
      approvals: approvals.rows.map((a) => ({
        approval_id: a.approval_id,
        approval_type: a.approval_type,
        label: a.label || `${a.approval_type}${a.amount ? ` · ₹${Number(a.amount).toLocaleString('en-IN')}` : ''}${a.customer_name ? ` · ${a.customer_name}` : ''}`,
      })),
    });
  } catch (e) { bad(res, e); }
};
