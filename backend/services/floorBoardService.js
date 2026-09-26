/**
 * Production screens — the floor board (PD1, PD9).
 *
 * One query for the whole floor, open tickets only (the old list returned every
 * ticket ever, F25). Who sees what:
 *   - "all data" users (managers, floor managers, QC inspectors, admins) see
 *     every open ticket;
 *   - everyone else sees their own tickets plus the UNASSIGNED tickets waiting
 *     in the stages their team works, so a ticket moved to Chip / Body / back to
 *     Diagnosis is never invisible (F20) and can be claimed (PD9);
 *   - floor managers always see the shared Floor Manager queue (PD1) — new
 *     laptops land there unassigned instead of on the lowest-id floor manager.
 */
const pool = require('../config/db');
const { resolveTicketListScope } = require('./dataScopeService');

const FLOOR_STAGES = [
  'Floor Manager', 'Diagnosis', 'Chip Level Repair', 'Dismantle', 'Procurement', 'Body & Paint',
  'Assembly & Software', 'Final Testing', 'QC1', 'QC2', 'Pending Inventory', 'Dispatch QC', 'Hold',
];
const STUCK_DAYS = 3;
const MANAGER_ROLES = new Set(['manager', 'admin', 'super_admin', 'floor_manager']);

async function myTeamIds(db, userId) {
  const r = await db.query(
    `SELECT team_id FROM users WHERE user_id = $1 AND team_id IS NOT NULL
     UNION SELECT team_id FROM user_teams WHERE user_id = $1`,
    [userId]
  );
  return r.rows.map((x) => Number(x.team_id));
}

/**
 * @param {object} req  express request (user + scope caches)
 * @param {object} q    { stage, view: 'queue'|'mine'|'unassigned'|'stuck', search }
 */
async function listBoard(req, q = {}) {
  const db = pool;
  const user = req.user || {};
  const userId = Number(user.user_id) || null;
  const scope = await resolveTicketListScope(req);
  const seesAll = scope.mode === 'all';
  const teams = userId ? await myTeamIds(db, userId) : [];
  const isFloorManager = String(user.role || '').toLowerCase() === 'floor_manager';

  const params = [FLOOR_STAGES];
  const vis = [];
  if (!seesAll) {
    params.push(userId, teams);
    vis.push(`(t.assigned_user_id = $2 OR (t.assigned_user_id IS NULL AND (t.assigned_team_id = ANY($3::int[])${isFloorManager ? " OR s.stage_name = 'Floor Manager'" : ''})))`);
  }
  const visSql = vis.length ? ` AND ${vis.join(' AND ')}` : '';

  const base = `
    FROM tickets t
    JOIN stages s ON s.stage_id = t.current_stage_id
    LEFT JOIN users u ON u.user_id = t.assigned_user_id
    LEFT JOIN vendor_serial_numbers v ON v.serial_id = t.vendor_serial_id
    WHERE t.status IN ('in_progress', 'on_hold') AND s.stage_name = ANY($1::text[])${visSql}`;

  const counts = await db.query(`SELECT s.stage_name, COUNT(*)::int AS n ${base} GROUP BY s.stage_name`, params);

  const filters = [];
  const fp = [...params];
  if (q.stage) { fp.push(q.stage); filters.push(`s.stage_name = $${fp.length}`); }
  if (q.view === 'mine' && userId) { fp.push(userId); filters.push(`t.assigned_user_id = $${fp.length}`); }
  if (q.view === 'unassigned') filters.push('t.assigned_user_id IS NULL');
  if (q.search) {
    fp.push(`%${String(q.search).trim()}%`);
    filters.push(`(t.ttspl_id ILIKE $${fp.length} OR t.serial_number ILIKE $${fp.length} OR t.model ILIKE $${fp.length})`);
  }
  const entered = `COALESCE((SELECT MAX(h.created_at) FROM production_ticket_history h WHERE h.ticket_id = t.ticket_id AND h.current_stage = s.stage_name), t.created_at)`;
  if (q.view === 'stuck') filters.push(`${entered} < NOW() - interval '${STUCK_DAYS} days'`);

  const rows = await db.query(
    `SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.brand, t.model, t.processor, t.ram, t.storage,
            t.status, t.ticket_type, t.priority, t.highlighted, t.highlighted_reason, t.qc_fail_count,
            t.received_condition, t.hold_reason, t.hold_from_stage_name, t.created_at,
            t.assigned_user_id, u.name AS assigned_name, t.assigned_team_id,
            s.stage_name, s.stage_order, v.inventory_status,
            ${entered} AS stage_entered_at,
            (SELECT COUNT(*)::int FROM part_requests pr WHERE pr.ticket_id = t.ticket_id
               AND pr.status IN ('pending', 'approved', 'escalated', 'ordered', 'received')
               AND COALESCE(pr.context, 'FLOOR') = 'FLOOR') AS open_parts
       ${base}${filters.length ? ` AND ${filters.join(' AND ')}` : ''}
      ORDER BY t.highlighted DESC, ${entered} ASC
      LIMIT 500`,
    fp
  );

  const canClaimAny = MANAGER_ROLES.has(String(user.role || '').toLowerCase());
  const byStage = Object.fromEntries(counts.rows.map((r) => [r.stage_name, r.n]));
  const mine = userId ? (await db.query(`SELECT COUNT(*)::int AS n ${base} AND t.assigned_user_id = ${Number(userId)}`, params)).rows[0].n : 0;
  const unassigned = (await db.query(`SELECT COUNT(*)::int AS n ${base} AND t.assigned_user_id IS NULL`, params)).rows[0].n;
  const stuck = (await db.query(`SELECT COUNT(*)::int AS n ${base} AND ${entered} < NOW() - interval '${STUCK_DAYS} days'`, params)).rows[0].n;

  return {
    stages: FLOOR_STAGES.map((name) => ({ name, count: byStage[name] || 0 })),
    counts: { total: counts.rows.reduce((n, r) => n + r.n, 0), mine, unassigned, stuck },
    stuck_days: STUCK_DAYS,
    sees_all: seesAll,
    rows: rows.rows.map((r) => ({
      ...r,
      days_in_stage: Math.floor((Date.now() - new Date(r.stage_entered_at)) / 86400000),
      can_claim: !r.assigned_user_id && (canClaimAny || teams.includes(Number(r.assigned_team_id))
        || (isFloorManager && r.stage_name === 'Floor Manager')),
    })),
  };
}

module.exports = { listBoard, FLOOR_STAGES, STUCK_DAYS };
