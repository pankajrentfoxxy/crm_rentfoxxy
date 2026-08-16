'use strict';

const { logEvent } = require('./supportTicketStateService');
const { assignWorkOrder } = require('./supportWorkOrderService');

function zoneMatch(tech, ctx) {
  if (!ctx.zoneId) return { ok: true };
  const zones = tech.zone_ids || (tech.zone_id != null ? [tech.zone_id] : []);
  if (zones.map(Number).includes(Number(ctx.zoneId))) return { ok: true };
  return { ok: false, rejected_by: 'zoneMatch', detail: `not in zone ${ctx.zoneCode || ctx.zoneId}` };
}

function skillMatch(tech, ctx) {
  if (!ctx.skillRequired) return { ok: true };
  const skills = tech.skills || [];
  if (skills.includes(ctx.skillRequired)) return { ok: true };
  return { ok: false, rejected_by: 'skillMatch', detail: `missing ${ctx.skillRequired}` };
}

function availability(tech, ctx) {
  if (tech.on_leave) return { ok: false, rejected_by: 'availability', detail: 'on approved leave' };
  if (tech.on_shift === false) return { ok: false, rejected_by: 'availability', detail: 'not on shift' };
  return { ok: true };
}

function capacity(tech) {
  const max = Number(tech.max_jobs_per_day || 6);
  const used = Number(tech.jobs_today || 0);
  if (used >= max) return { ok: false, rejected_by: 'capacity', detail: `${used} of ${max}` };
  return { ok: true };
}

function continuity(tech, ctx) {
  if (ctx.previousVisitorId && Number(tech.user_id) === Number(ctx.previousVisitorId)) {
    return { ok: true, bonus: 1000 };
  }
  return { ok: true, bonus: 0 };
}

function proximity(tech) {
  if (tech.distance_km == null) return { ok: true, bonus: 0 };
  return { ok: true, bonus: Math.max(0, 100 - Number(tech.distance_km)) };
}

function loadBalance(tech) {
  return { ok: true, bonus: Math.max(0, 50 - Number(tech.jobs_today || 0) * 5) };
}

const HARD = [zoneMatch, skillMatch, availability, capacity];

function evaluateCandidate(tech, ctx) {
  const considered = { user_id: tech.user_id, name: tech.name };
  for (const rule of HARD) {
    const r = rule(tech, ctx);
    if (!r.ok) return { ok: false, ...considered, rejected_by: r.rejected_by, detail: r.detail };
  }
  const score = continuity(tech, ctx).bonus + proximity(tech).bonus + loadBalance(tech).bonus;
  return { ok: true, ...considered, score };
}

function pickAssignee(candidates, ctx) {
  const considered = candidates.map((t) => evaluateCandidate(t, ctx));
  const ok = considered.filter((c) => c.ok).sort((a, b) => b.score - a.score);
  return { pick: ok[0] || null, considered };
}

function visitGroupKey(row) {
  const day = String(row.slot_start || row.scheduled_start || row.created_at || '').slice(0, 10);
  return `${row.customer_id || 0}:${row.site_id || row.site_label || ''}:${day}`;
}

function sortBucketRows(rows) {
  return [...rows].sort((a, b) => {
    const now = Date.now();
    const aB = a.sla_due_at && new Date(a.sla_due_at) < now ? 0 : 1;
    const bB = b.sla_due_at && new Date(b.sla_due_at) < now ? 0 : 1;
    if (aB !== bB) return aB - bB;
    const ap = a.priority == null ? 99 : Number(a.priority);
    const bp = b.priority == null ? 99 : Number(b.priority);
    if (ap !== bp) return ap - bp;
    const as = a.slot_start ? new Date(a.slot_start).getTime() : Infinity;
    const bs = b.slot_start ? new Date(b.slot_start).getTime() : Infinity;
    if (as !== bs) return as - bs;
    const ad = a.distance_km == null ? Infinity : Number(a.distance_km);
    const bd = b.distance_km == null ? Infinity : Number(b.distance_km);
    return ad - bd;
  });
}

function groupVisits(rows) {
  const map = new Map();
  for (const r of sortBucketRows(rows)) {
    const key = visitGroupKey(r);
    if (!map.has(key)) {
      map.set(key, {
        group_key: key,
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        site_label: r.site_label,
        site_id: r.site_id,
        priority: r.priority,
        sla_due_at: r.sla_due_at,
        slot_start: r.slot_start,
        distance_km: r.distance_km,
        contact_phone: r.contact_phone,
        jobs: [],
      });
    }
    const g = map.get(key);
    g.jobs.push(r);
    if (r.priority != null && (g.priority == null || Number(r.priority) < Number(g.priority))) g.priority = r.priority;
    if (r.sla_due_at && (!g.sla_due_at || new Date(r.sla_due_at) < new Date(g.sla_due_at))) g.sla_due_at = r.sla_due_at;
    if (r.slot_start && (!g.slot_start || new Date(r.slot_start) < new Date(g.slot_start))) g.slot_start = r.slot_start;
    if (r.distance_km != null && (g.distance_km == null || Number(r.distance_km) < Number(g.distance_km))) {
      g.distance_km = r.distance_km;
    }
  }
  return [...map.values()];
}

const BUCKET_SELECT = `
  w.wo_id, w.wo_number, w.wo_type, w.status, w.assigned_to, w.ticket_id,
  w.document_number, w.notes, w.distance_km,
  COALESCE(w.slot_start, w.scheduled_start) AS slot_start,
  COALESCE(w.slot_end, w.scheduled_end) AS slot_end,
  COALESCE(w.priority, t.priority) AS priority,
  COALESCE(w.sla_due_at, t.sla_resolution_due_at) AS sla_due_at,
  t.ticket_number, t.customer_id, t.site_id, t.site_label, t.contact_name, t.contact_phone,
  COALESCE(c.company_name, c.name) AS customer_name,
  (SELECT ca.pincode FROM customer_addresses ca
    WHERE ca.customer_id = t.customer_id
    ORDER BY ca.is_head_office DESC NULLS LAST LIMIT 1) AS pincode,
  (SELECT COUNT(*)::int FROM support_work_order_assets a WHERE a.wo_id = w.wo_id) AS asset_count,
  (SELECT a.ttspl_id FROM support_work_order_assets l
     JOIN support_ticket_assets a ON a.line_id = l.line_id
    WHERE l.wo_id = w.wo_id ORDER BY l.wo_asset_id LIMIT 1) AS primary_ttspl,
  (SELECT i.name FROM support_ticket_assets a
     JOIN support_issue_catalog i ON i.catalog_id = a.reported_issue_id
    WHERE a.ticket_id = t.ticket_id ORDER BY a.line_id LIMIT 1) AS issue_name,
  (SELECT i.name FROM support_ticket_assets a
     JOIN support_issue_catalog i ON i.catalog_id = a.reported_type_id
    WHERE a.ticket_id = t.ticket_id ORDER BY a.line_id LIMIT 1) AS type_name
`;

function tabWhere(tab, params) {
  if (tab === 'completed') {
    return `w.status = 'COMPLETED'
      AND COALESCE(w.completed_at, w.updated_at) >= NOW() - INTERVAL '14 days'`;
  }
  const open = `w.status NOT IN ('COMPLETED','CANCELLED')`;
  if (tab === 'overdue') {
    return `${open} AND COALESCE(w.sla_due_at, t.sla_resolution_due_at) < NOW()`;
  }
  if (tab === 'upcoming') {
    return `${open} AND (COALESCE(w.slot_start, w.scheduled_start) AT TIME ZONE 'Asia/Kolkata')::date
      > (NOW() AT TIME ZONE 'Asia/Kolkata')::date`;
  }
  return `${open} AND (
    COALESCE(w.slot_start, w.scheduled_start, w.created_at) IS NULL
    OR (COALESCE(w.slot_start, w.scheduled_start, w.created_at) AT TIME ZONE 'Asia/Kolkata')::date
       <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date
  )`;
}

async function loadMyBucket(db, userId, query = {}) {
  const tab = String(query.tab || 'today');
  const params = [userId];
  const where = tabWhere(tab, params);
  const rows = (await db.query(
    `SELECT ${BUCKET_SELECT}
       FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE w.assigned_to = $1
        AND ${where}
      ORDER BY
        CASE WHEN COALESCE(w.sla_due_at, t.sla_resolution_due_at) < NOW() THEN 0 ELSE 1 END,
        COALESCE(w.priority, t.priority) ASC NULLS LAST,
        COALESCE(w.slot_start, w.scheduled_start) ASC NULLS LAST,
        w.distance_km ASC NULLS LAST`,
    params
  )).rows;
  return { tab, groups: groupVisits(rows), rows };
}

async function bucketSummary(db, userId) {
  const r = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE w.status NOT IN ('COMPLETED','CANCELLED')
          AND (COALESCE(w.slot_start, w.scheduled_start, w.created_at) AT TIME ZONE 'Asia/Kolkata')::date
              = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today,
        COUNT(*) FILTER (WHERE w.status = 'COMPLETED'
          AND (COALESCE(w.completed_at, w.updated_at) AT TIME ZONE 'Asia/Kolkata')::date
              = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS done,
        COUNT(*) FILTER (WHERE w.status NOT IN ('COMPLETED','CANCELLED')
          AND COALESCE(w.sla_due_at, t.sla_resolution_due_at) < NOW())::int AS overdue,
        COUNT(*) FILTER (WHERE w.status NOT IN ('COMPLETED','CANCELLED'))::int AS open
       FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
      WHERE w.assigned_to = $1`,
    [userId]
  );
  const next = await db.query(
    `SELECT w.wo_id, COALESCE(c.company_name, c.name) AS customer_name, t.site_label,
            COALESCE(w.slot_start, w.scheduled_start) AS slot_start, w.distance_km
       FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE w.assigned_to = $1 AND w.status NOT IN ('COMPLETED','CANCELLED')
      ORDER BY COALESCE(w.slot_start, w.scheduled_start) ASC NULLS LAST
      LIMIT 1`,
    [userId]
  );
  return { ...r.rows[0], next: next.rows[0] || null };
}

async function loadWoContext(db, wo) {
  const ticket = (await db.query(
    `SELECT t.*, COALESCE(c.company_name, c.name) AS customer_name,
            (SELECT ca.pincode FROM customer_addresses ca
              WHERE ca.customer_id = t.customer_id
              ORDER BY ca.is_head_office DESC NULLS LAST LIMIT 1) AS pincode
       FROM support_tickets_v2 t
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE t.ticket_id = $1`,
    [wo.ticket_id]
  )).rows[0];
  const skill = (await db.query(
    `SELECT COALESCE(i.skill_required, s.skill_required) AS skill
       FROM support_ticket_assets a
       JOIN support_issue_catalog i ON i.catalog_id = a.reported_issue_id
       JOIN support_issue_catalog s ON s.catalog_id = a.reported_subtype_id
      WHERE a.ticket_id = $1
      ORDER BY a.line_id LIMIT 1`,
    [wo.ticket_id]
  )).rows[0];
  const pin = String((ticket && ticket.pincode) || '').replace(/\D/g, '').slice(0, 6);
  let zone = null;
  if (pin) {
    zone = (await db.query(
      `SELECT z.zone_id, z.code FROM support_zone_pincodes p
         JOIN support_zones z ON z.zone_id = p.zone_id
        WHERE $1 BETWEEN p.pincode_from AND p.pincode_to
        LIMIT 1`,
      [pin]
    )).rows[0];
  }
  const prev = (await db.query(
    `SELECT assigned_to FROM support_work_orders
      WHERE ticket_id = $1 AND assigned_to IS NOT NULL AND wo_id <> $2
        AND status IN ('COMPLETED','ON_SITE','IN_PROGRESS','ACCEPTED')
      ORDER BY completed_at DESC NULLS LAST, updated_at DESC LIMIT 1`,
    [wo.ticket_id, wo.wo_id]
  )).rows[0];
  return {
    zoneId: zone && zone.zone_id,
    zoneCode: zone && zone.code,
    skillRequired: skill && skill.skill,
    previousVisitorId: prev && prev.assigned_to,
    ticket,
  };
}

async function loadTechnicians(db, { date, zoneId, groupId } = {}) {
  const day = date || new Date().toISOString().slice(0, 10);
  const dow = new Date(`${day}T12:00:00`).getDay();
  const params = [day, dow];
  let extra = '';
  if (zoneId) {
    params.push(Number(zoneId));
    extra += ` AND g.zone_id = $${params.length}`;
  }
  if (groupId) {
    params.push(Number(groupId));
    extra += ` AND g.group_id = $${params.length}`;
  }
  const rows = await db.query(
    `SELECT u.user_id, u.name,
            ARRAY_AGG(DISTINCT g.zone_id) FILTER (WHERE g.zone_id IS NOT NULL) AS zone_ids,
            COALESCE(ARRAY_AGG(DISTINCT sk.code) FILTER (WHERE sk.code IS NOT NULL), '{}') AS skills,
            COALESCE(MAX(s.max_jobs_per_day), 6) AS max_jobs_per_day,
            EXISTS (
              SELECT 1 FROM user_leaves l
               WHERE l.user_id = u.user_id AND l.leave_date = $1::date
            ) AS on_leave,
            EXISTS (
              SELECT 1 FROM user_shifts sh
               WHERE sh.user_id = u.user_id AND sh.day_of_week = $2
            ) AS on_shift,
            (
              SELECT COUNT(*)::int FROM support_work_orders w
               WHERE w.assigned_to = u.user_id
                 AND w.status NOT IN ('COMPLETED','CANCELLED','FAILED')
                 AND (COALESCE(w.slot_start, w.scheduled_start, w.created_at) AT TIME ZONE 'Asia/Kolkata')::date
                     = $1::date
            ) AS jobs_today
       FROM users u
       JOIN support_group_members gm ON gm.user_id = u.user_id
       JOIN support_assignment_groups g ON g.group_id = gm.group_id AND g.is_active = TRUE
       LEFT JOIN user_skills us ON us.user_id = u.user_id
       LEFT JOIN support_skills sk ON sk.skill_id = us.skill_id
       LEFT JOIN user_shifts s ON s.user_id = u.user_id AND s.day_of_week = $2
      WHERE 1=1 ${extra}
      GROUP BY u.user_id, u.name
      ORDER BY u.name`,
    params
  );
  return rows.rows.map((r) => ({
    ...r,
    on_shift: r.on_shift !== false,
    skills: r.skills || [],
    zone_ids: r.zone_ids || [],
  }));
}

async function autoAssign(client, { date, zone, dry_run, actorId }) {
  const zoneRow = zone
    ? (await client.query('SELECT zone_id, code FROM support_zones WHERE code = $1 OR zone_id::text = $1', [String(zone)])).rows[0]
    : null;
  const techs = await loadTechnicians(client, { date, zoneId: zoneRow && zoneRow.zone_id });
  const wos = (await client.query(
    `SELECT w.* FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
      WHERE w.status IN ('DRAFT','PENDING_ASSIGNMENT')
        AND w.assigned_to IS NULL
        AND ($1::int IS NULL OR t.assignment_group_id IN (
              SELECT group_id FROM support_assignment_groups WHERE zone_id = $1
            ))
      ORDER BY COALESCE(w.priority, t.priority) ASC, w.wo_id`,
    [zoneRow ? zoneRow.zone_id : null]
  )).rows;

  const results = [];
  for (const wo of wos) {
    const ctx = await loadWoContext(client, wo);
    const { pick, considered } = pickAssignee(techs, ctx);
    if (!pick) {
      results.push({
        wo_id: wo.wo_id,
        assigned_to: null,
        reason: `No available technician${ctx.skillRequired ? ` with skill ${ctx.skillRequired}` : ''}${ctx.zoneCode ? ` in zone ${ctx.zoneCode}` : ''}`,
        considered,
      });
      await logEvent(client, {
        ticketId: wo.ticket_id,
        woId: wo.wo_id,
        eventType: 'ASSIGNMENT_UNASSIGNED',
        actorKind: 'SYSTEM',
        summary: 'Auto-assign found no eligible technician',
        detail: { considered },
      });
      continue;
    }
    if (!dry_run) {
      await assignWorkOrder(client, wo.wo_id, { userId: pick.user_id }, actorId);
      const hit = techs.find((t) => Number(t.user_id) === Number(pick.user_id));
      if (hit) hit.jobs_today = Number(hit.jobs_today || 0) + 1;
    }
    results.push({ wo_id: wo.wo_id, assigned_to: pick.user_id, name: pick.name, reason: 'assigned', considered });
  }
  return { dry_run: Boolean(dry_run), results };
}

async function dispatchAssign(client, { wo_id, user_id, slot_start, slot_end }, actorId) {
  const wo = (await client.query('SELECT * FROM support_work_orders WHERE wo_id = $1', [wo_id])).rows[0];
  if (!wo) throw Object.assign(new Error('Work order not found'), { status: 404 });
  const techs = await loadTechnicians(client, {});
  const tech = techs.find((t) => Number(t.user_id) === Number(user_id));
  const ctx = await loadWoContext(client, wo);
  const evald = tech ? evaluateCandidate(tech, ctx) : { ok: false, rejected_by: 'unknown', detail: 'technician not in a support group' };
  const warnings = [];
  if (!evald.ok) warnings.push({ code: evald.rejected_by, detail: evald.detail });
  if (slot_start && (wo.sla_due_at || ctx.ticket && ctx.ticket.sla_resolution_due_at)) {
    const due = new Date(wo.sla_due_at || ctx.ticket.sla_resolution_due_at);
    if (new Date(slot_start) > due) warnings.push({ code: 'SLA_SLOT', detail: 'will breach — slot too late' });
  }
  await assignWorkOrder(client, wo_id, { userId: user_id, slot_start, slot_end }, actorId);
  return { wo_id, assigned_to: user_id, warnings };
}

async function dispatchBoard(db, query = {}) {
  const date = query.date || new Date().toISOString().slice(0, 10);
  const zoneRow = query.zone
    ? (await db.query('SELECT zone_id, code FROM support_zones WHERE code = $1 OR zone_id::text = $1', [String(query.zone)])).rows[0]
    : null;
  const techs = await loadTechnicians(db, {
    date,
    zoneId: zoneRow && zoneRow.zone_id,
    groupId: query.group ? Number(query.group) : null,
  });
  const jobs = (await db.query(
    `SELECT ${BUCKET_SELECT}
       FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE w.status NOT IN ('CANCELLED')
        AND (
          w.assigned_to IS NULL
          OR (COALESCE(w.slot_start, w.scheduled_start, w.created_at) AT TIME ZONE 'Asia/Kolkata')::date = $1::date
        )
      ORDER BY COALESCE(w.priority, t.priority) ASC, w.wo_id`,
    [date]
  )).rows;
  const unassigned = jobs.filter((j) => !j.assigned_to || j.status === 'PENDING_ASSIGNMENT' || j.status === 'DRAFT');
  const assigned = jobs.filter((j) => j.assigned_to && j.status !== 'DRAFT');
  return {
    date,
    slots: ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00'],
    technicians: techs.map((t) => ({
      ...t,
      over_capacity: Number(t.jobs_today) >= Number(t.max_jobs_per_day),
    })),
    unassigned,
    assigned,
  };
}

async function dispatchCapacity(db, query = {}) {
  const date = query.date || new Date().toISOString().slice(0, 10);
  const zoneRow = query.zone
    ? (await db.query('SELECT zone_id FROM support_zones WHERE code = $1 OR zone_id::text = $1', [String(query.zone)])).rows[0]
    : null;
  const techs = await loadTechnicians(db, { date, zoneId: zoneRow && zoneRow.zone_id });
  return {
    date,
    rows: techs.map((t) => ({
      user_id: t.user_id,
      name: t.name,
      jobs_today: t.jobs_today,
      max_jobs_per_day: t.max_jobs_per_day,
      remaining: Math.max(0, t.max_jobs_per_day - t.jobs_today),
      on_leave: t.on_leave,
    })),
  };
}

module.exports = {
  zoneMatch,
  skillMatch,
  availability,
  capacity,
  continuity,
  proximity,
  loadBalance,
  evaluateCandidate,
  pickAssignee,
  visitGroupKey,
  sortBucketRows,
  groupVisits,
  loadMyBucket,
  bucketSummary,
  autoAssign,
  dispatchAssign,
  dispatchBoard,
  dispatchCapacity,
  loadTechnicians,
};
