'use strict';

const { logEvent } = require('./supportTicketStateService');
const { assignWorkOrder } = require('./supportWorkOrderService');

const DISPATCH_SLOTS = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00'];
const SUPPORT_ROLES = ['support_tech', 'technician', 'support_lead', 'support_manager', 'support_agent'];

function istDateStr(value) {
  if (!value) {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function istHm(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    const m = String(value).match(/T(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : null;
  }
  return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
}

function dowForDate(day) {
  return new Date(`${day}T12:00:00+05:30`).getDay();
}

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

function availability(tech) {
  if (tech.marked_absent || tech.on_leave) {
    return { ok: false, rejected_by: 'availability', detail: 'marked absent / on leave' };
  }
  if (tech.on_shift === false) {
    return { ok: false, rejected_by: 'availability', detail: 'not on shift that day' };
  }
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
  const day = istDateStr(date);
  const dow = dowForDate(day);
  const params = [day, dow, SUPPORT_ROLES];
  let extra = '';
  if (zoneId) {
    params.push(Number(zoneId));
    extra += ` AND EXISTS (
      SELECT 1 FROM support_group_members gm2
      JOIN support_assignment_groups g2 ON g2.group_id = gm2.group_id AND g2.is_active = TRUE
      WHERE gm2.user_id = u.user_id AND g2.zone_id = $${params.length}
    )`;
  }
  if (groupId) {
    params.push(Number(groupId));
    extra += ` AND EXISTS (
      SELECT 1 FROM support_group_members gm3
      WHERE gm3.user_id = u.user_id AND gm3.group_id = $${params.length}
    )`;
  }
  const rows = await db.query(
    `SELECT u.user_id, u.name, u.role,
            ARRAY_AGG(DISTINCT g.zone_id) FILTER (WHERE g.zone_id IS NOT NULL) AS zone_ids,
            COALESCE(ARRAY_AGG(DISTINCT sk.code) FILTER (WHERE sk.code IS NOT NULL), '{}') AS skills,
            COALESCE(MAX(s.max_jobs_per_day), 6) AS max_jobs_per_day,
            EXISTS (
              SELECT 1 FROM user_leaves l
               WHERE l.user_id = u.user_id AND l.leave_date = $1::date
            ) AS on_leave,
            EXISTS (
              SELECT 1 FROM support_technician_attendance a
               WHERE a.user_id = u.user_id AND a.work_date = $1::date AND a.status = 'ABSENT'
            ) AS marked_absent,
            EXISTS (
              SELECT 1 FROM user_shifts sh
               WHERE sh.user_id = u.user_id AND sh.day_of_week = $2
            ) AS on_shift_row,
            EXISTS (
              SELECT 1 FROM user_shifts sh
               WHERE sh.user_id = u.user_id
            ) AS has_any_shift,
            (
              SELECT COUNT(*)::int FROM support_work_orders w
               WHERE w.assigned_to = u.user_id
                 AND w.status NOT IN ('COMPLETED','CANCELLED','FAILED')
                 AND (COALESCE(w.slot_start, w.scheduled_start, w.created_at) AT TIME ZONE 'Asia/Kolkata')::date
                     = $1::date
            ) AS jobs_today
       FROM users u
       LEFT JOIN support_group_members gm ON gm.user_id = u.user_id
       LEFT JOIN support_assignment_groups g ON g.group_id = gm.group_id AND g.is_active = TRUE
       LEFT JOIN user_skills us ON us.user_id = u.user_id
       LEFT JOIN support_skills sk ON sk.skill_id = us.skill_id
       LEFT JOIN user_shifts s ON s.user_id = u.user_id AND s.day_of_week = $2
      WHERE COALESCE(u.active, TRUE) = TRUE
        AND (
          u.role = ANY($3::text[])
          OR EXISTS (
            SELECT 1 FROM support_group_members m
            JOIN support_assignment_groups gg ON gg.group_id = m.group_id AND gg.is_active = TRUE
            WHERE m.user_id = u.user_id
          )
        )
        ${extra}
      GROUP BY u.user_id, u.name, u.role
      ORDER BY u.name`,
    params
  );
  return rows.rows.map((r) => {
    const hasAny = Boolean(r.has_any_shift);
    const onShiftRow = Boolean(r.on_shift_row);
    const onShift = hasAny ? onShiftRow : dow !== 0;
    return {
      ...r,
      on_leave: Boolean(r.on_leave),
      marked_absent: Boolean(r.marked_absent),
      on_shift: onShift,
      skills: r.skills || [],
      zone_ids: r.zone_ids || [],
    };
  });
}

async function assertAssignable(db, userId, when) {
  if (!userId) return;
  const day = istDateStr(when);
  const techs = await loadTechnicians(db, { date: day });
  const tech = techs.find((t) => Number(t.user_id) === Number(userId));
  if (!tech) {
    throw Object.assign(new Error('That person is not on the support assignment list'), { status: 400 });
  }
  const avail = availability(tech);
  if (!avail.ok) {
    throw Object.assign(new Error(`Cannot assign: ${avail.detail}`), { status: 409, code: avail.rejected_by });
  }
  const cap = capacity(tech);
  if (!cap.ok) {
    throw Object.assign(new Error(`Cannot assign: at daily capacity (${cap.detail})`), { status: 409, code: 'capacity' });
  }
}

async function assigneeAvailability(db, userId, { from, days = 7 } = {}) {
  const start = istDateStr(from);
  const out = [];
  for (let i = 0; i < Math.min(Number(days) || 7, 14); i += 1) {
    const d = new Date(`${start}T12:00:00+05:30`);
    d.setDate(d.getDate() + i);
    const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const techs = await loadTechnicians(db, { date: day });
    const tech = techs.find((t) => Number(t.user_id) === Number(userId));
    const booked = tech
      ? (await db.query(
        `SELECT (COALESCE(slot_start, scheduled_start) AT TIME ZONE 'Asia/Kolkata')::time AS t
           FROM support_work_orders
          WHERE assigned_to = $1
            AND status NOT IN ('COMPLETED','CANCELLED','FAILED')
            AND (COALESCE(slot_start, scheduled_start, created_at) AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
        [userId, day]
      )).rows.map((r) => String(r.t || '').slice(0, 5))
      : [];
    const avail = tech ? availability(tech) : { ok: false, detail: 'not assignable' };
    const cap = tech ? capacity(tech) : { ok: false };
    const free = DISPATCH_SLOTS.filter((slot) => !booked.includes(slot));
    out.push({
      date: day,
      dow: dowForDate(day),
      on_shift: tech ? tech.on_shift : false,
      on_leave: tech ? tech.on_leave : false,
      marked_absent: tech ? tech.marked_absent : false,
      jobs_today: tech ? tech.jobs_today : 0,
      max_jobs_per_day: tech ? tech.max_jobs_per_day : 0,
      remaining: tech ? Math.max(0, tech.max_jobs_per_day - tech.jobs_today) : 0,
      available: Boolean(avail.ok && cap.ok),
      reason: avail.ok ? (cap.ok ? null : cap.detail) : avail.detail,
      slots: DISPATCH_SLOTS.map((slot) => ({
        slot,
        free: Boolean(avail.ok && cap.ok && !booked.includes(slot)),
      })),
      free_slots: avail.ok && cap.ok ? free : [],
    });
  }
  return { user_id: Number(userId), days: out };
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
  const day = istDateStr(slot_start);
  const techs = await loadTechnicians(client, { date: day });
  const tech = techs.find((t) => Number(t.user_id) === Number(user_id));
  const ctx = await loadWoContext(client, wo);
  const evald = tech
    ? evaluateCandidate(tech, ctx)
    : { ok: false, rejected_by: 'unknown', detail: 'person is not on the support assignment list' };
  if (!evald.ok) {
    throw Object.assign(new Error(`Cannot assign: ${evald.detail}`), { status: 409, code: evald.rejected_by });
  }
  const warnings = [];
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
      blocked: Boolean(t.marked_absent || t.on_leave || !t.on_shift),
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
      marked_absent: t.marked_absent,
      on_shift: t.on_shift,
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
  assertAssignable,
  assigneeAvailability,
  DISPATCH_SLOTS,
  SUPPORT_ROLES,
  istDateStr,
  istHm,
};
