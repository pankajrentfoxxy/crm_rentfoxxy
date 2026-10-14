/**
 * QC inspector performance (migration 423; Production → Floor performance →
 * QC inspectors). The QC counterpart of technicianPerformanceService.
 *
 * Definitions — every number comes from these, from production_ticket_history:
 *
 *   check     a QC1, QC2 or Dispatch QC decision (pass or fail), credited to
 *             whoever made it (performed_by). People rotate between the three
 *             stages, so one person's checks can span all three.
 *   missed    a PASS that later proved wrong:
 *               QC1 pass   → the same laptop then failed QC2 or Dispatch QC
 *                            before it next came back to QC1
 *               QC2 pass   → the same laptop failed Dispatch QC within 30 days
 *               Dispatch QC pass → the customer raised a complaint or repair
 *                            pickup for that laptop within 15 days
 *   fails found  failed decisions — defects caught (shown, counted as checks)
 *   correct   checks − missed. Passes still inside their window can still be
 *             missed, so they are flagged "open".
 *   target    daily target × working days (Mon–Sat, IST) up to today.
 */
const pool = require('../config/db');
const tech = require('./technicianPerformanceService');

const STAGES = ['QC1', 'QC2', 'Dispatch QC'];
const QC2_WINDOW_DAYS = 30;
const DISPATCH_WINDOW_DAYS = 15;

/** Every QC decision made in [from, to] (IST days), with its missed verdict. */
async function loadChecks(db, { from, to, userId = null }) {
  const params = [from, to, STAGES, QC2_WINDOW_DAYS, DISPATCH_WINDOW_DAYS];
  let userSql = '';
  if (userId) { params.push(Number(userId)); userSql = `AND d.inspector_id = $${params.length}`; }
  const { rows } = await db.query(
    `WITH ev AS (
       SELECT h.id, h.ticket_id, h.ttspl_id, h.created_at, h.performed_by AS inspector_id,
              h.previous_stage AS stage,
              CASE WHEN h.action ILIKE '%failed%' THEN 'fail' ELSE 'pass' END AS decision,
              COALESCE(NULLIF(h.failure_reason, ''), NULLIF(h.remarks, '')) AS note,
              LAG(h.created_at) OVER (PARTITION BY h.ticket_id, h.previous_stage ORDER BY h.created_at, h.id) AS prev_at
         FROM production_ticket_history h
        WHERE h.previous_stage = ANY($3::text[])
          AND h.current_stage IS DISTINCT FROM h.previous_stage
          AND (h.action ILIKE '%failed%' OR h.action ILIKE '%passed%'
               OR (h.previous_stage = 'QC2' AND h.current_stage IN ('Pending Inventory', 'Inventory')))
     ),
     -- The same decision written twice seconds apart is one check.
     d AS (
       SELECT ev.*,
              LEAD(ev.created_at) OVER (PARTITION BY ev.ticket_id, ev.stage ORDER BY ev.created_at, ev.id) AS next_same_stage_at
         FROM ev
        WHERE ev.prev_at IS NULL OR ev.created_at - ev.prev_at > INTERVAL '2 minutes'
     )
     SELECT d.id, d.ticket_id, d.ttspl_id, d.created_at AS checked_at, d.inspector_id, d.stage, d.decision, d.note,
            (d.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
            t.sales_order_number,
            m.missed_at, m.missed_how, m.missed_ref
       FROM d
       LEFT JOIN tickets t ON t.ticket_id = d.ticket_id
       LEFT JOIN LATERAL (
         SELECT x.at AS missed_at, x.how AS missed_how, x.ref AS missed_ref
           FROM (
             -- QC1 pass, then a later QC fail on the same ticket before the next QC1 decision.
             SELECT h2.created_at AS at, h2.previous_stage || ' failed' AS how, COALESCE(NULLIF(h2.failure_reason, ''), h2.remarks) AS ref
               FROM production_ticket_history h2
              WHERE d.stage = 'QC1' AND d.decision = 'pass'
                AND h2.ticket_id = d.ticket_id
                AND h2.previous_stage IN ('QC2', 'Dispatch QC') AND h2.action ILIKE '%failed%'
                AND h2.created_at > d.created_at
                AND (d.next_same_stage_at IS NULL OR h2.created_at < d.next_same_stage_at)
             UNION ALL
             -- QC2 pass, then the same laptop failed Dispatch QC within the window.
             SELECT h3.created_at, 'Dispatch QC failed', COALESCE(NULLIF(h3.failure_reason, ''), h3.remarks)
               FROM production_ticket_history h3
              WHERE d.stage = 'QC2' AND d.decision = 'pass' AND d.ttspl_id IS NOT NULL
                AND h3.ttspl_id = d.ttspl_id
                AND h3.previous_stage = 'Dispatch QC' AND h3.action ILIKE '%failed%'
                AND h3.created_at > d.created_at
                AND h3.created_at <= d.created_at + ($4 || ' days')::interval
             UNION ALL
             -- Dispatch QC pass, then a complaint / repair pickup within the window.
             SELECT sti.created_at,
                    CASE WHEN sti.item_type = 'complaint' THEN 'Customer complaint' ELSE 'Repair pickup' END,
                    'Support ticket #' || sti.ticket_id
               FROM support_ticket_items sti
              WHERE d.stage = 'Dispatch QC' AND d.decision = 'pass' AND d.ttspl_id IS NOT NULL
                AND (sti.ttspl_id = d.ttspl_id OR sti.unique_serial_number = d.ttspl_id)
                AND (sti.item_type = 'complaint' OR (sti.item_type = 'pickup' AND sti.pickup_type = 'repair'))
                AND COALESCE(sti.status, '') <> 'cancelled'
                AND sti.created_at > d.created_at
                AND sti.created_at <= d.created_at + ($5 || ' days')::interval
           ) x
          ORDER BY x.at
          LIMIT 1
       ) m ON TRUE
      WHERE (d.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        AND d.inspector_id IS NOT NULL
        ${userSql}
      ORDER BY d.created_at`,
    params
  );
  const now = Date.now();
  return rows.map((r) => {
    const windowDays = r.stage === 'QC2' ? QC2_WINDOW_DAYS : r.stage === 'Dispatch QC' ? DISPATCH_WINDOW_DAYS : null;
    const windowOpen = r.decision === 'pass' && !r.missed_at && windowDays != null
      && now - new Date(r.checked_at).getTime() < windowDays * 86400000;
    return { ...r, missed: Boolean(r.missed_at), window_open: windowOpen };
  });
}

function tally(checks) {
  const by = (st) => checks.filter((c) => c.stage === st).length;
  const missed = checks.filter((c) => c.missed).length;
  const passes = checks.filter((c) => c.decision === 'pass').length;
  return {
    checks: checks.length,
    qc1: by('QC1'),
    qc2: by('QC2'),
    dispatch_qc: by('Dispatch QC'),
    passed: passes,
    fails_found: checks.filter((c) => c.decision === 'fail').length,
    missed,
    open: checks.filter((c) => c.window_open).length,
    correct: checks.length - missed,
    // Of the passes, how many held up.
    accuracy: passes ? Math.round(((passes - missed) / passes) * 100) : null,
  };
}

async function summary(db = pool, { from: fromRaw, to: toRaw } = {}) {
  const range = tech.normaliseRange(fromRaw, toRaw);
  const [checks, targets] = await Promise.all([loadChecks(db, range), tech.loadTargets(db, 'qc')]);
  const ids = [...new Set(checks.map((c) => Number(c.inspector_id)))];
  // The QC team(s) show even with zero checks; anyone else who made a check shows too.
  const { rows: people } = await db.query(
    `SELECT DISTINCT u.user_id, u.name, u.role, u.active
       FROM users u
      WHERE u.user_id = ANY($1::int[])
         OR (COALESCE(u.active, TRUE) AND u.role = 'qc')`,
    [ids]
  );
  const inspectors = people.map((p) => {
    const mine = checks.filter((c) => Number(c.inspector_id) === Number(p.user_id));
    const t = tally(mine);
    // The default target is for QC inspectors; anyone else who stepped in
    // (a floor manager doing a few checks) has none unless given their own.
    const daily = targets.byUser.has(Number(p.user_id)) ? targets.byUser.get(Number(p.user_id))
      : (p.role === 'qc' ? targets.default : 0);
    const target = daily * range.workingDays;
    return {
      user_id: p.user_id,
      name: p.name,
      role: p.role,
      active: p.active !== false,
      daily_target: daily,
      own_target: targets.byUser.has(Number(p.user_id)),
      target,
      ...t,
      vs_target: target ? t.correct - target : null,
      standing: tech.standing(t.correct, target),
      eligible: target > 0 && t.correct >= target,
      provisional: t.open > 0,
    };
  })
    .filter((x) => x.active || x.checks)
    .sort((a, b) => (b.correct - a.correct) || (b.checks - a.checks) || String(a.name).localeCompare(String(b.name)));

  const worked = inspectors.filter((x) => x.checks);
  const days = tech.daysBetween(range.from, range.to).map((day) => ({
    day, working: tech.isWorkingDay(day), future: day > range.today, ...tally(checks.filter((c) => c.day === day)),
  }));
  return {
    period: range,
    definitions: {
      check: 'A QC1, QC2 or Dispatch QC decision — pass or fail — credited to whoever made it, at any stage.',
      missed: `A pass that proved wrong: QC1 pass then QC2 / Dispatch QC failed it; QC2 pass then Dispatch QC failed it within ${QC2_WINDOW_DAYS} days; Dispatch QC pass then a customer complaint or repair pickup within ${DISPATCH_WINDOW_DAYS} days.`,
      correct: 'Checks minus missed. Passes still inside their window are "open" and can still be missed.',
      target: 'Daily target × working days (Mon–Sat) in the period, up to today. The default target applies to QC inspectors; anyone else has one only if a manager sets it. The team target adds up the inspectors who worked.',
    },
    default_daily_target: targets.default,
    team: {
      ...tally(checks),
      target: worked.reduce((s, x) => s + x.target, 0),
      daily_target: worked.reduce((s, x) => s + x.daily_target, 0),
      inspectors: worked.length,
      with_target: worked.filter((x) => x.target > 0).length,
      eligible: worked.filter((x) => x.eligible).length,
    },
    inspectors,
    days,
  };
}

async function inspectorDetail(db = pool, { userId, from: fromRaw, to: toRaw }) {
  const range = tech.normaliseRange(fromRaw, toRaw);
  const uid = Number(userId);
  if (!uid) throw new tech.PerformanceError('Inspector is required');
  const user = (await db.query('SELECT user_id, name, role FROM users WHERE user_id = $1', [uid])).rows[0];
  if (!user) throw new tech.PerformanceError('Inspector not found', 404);
  const [checks, targets] = await Promise.all([loadChecks(db, { ...range, userId: uid }), tech.loadTargets(db, 'qc')]);
  const daily = targets.byUser.has(uid) ? targets.byUser.get(uid) : (user.role === 'qc' ? targets.default : 0);
  return {
    period: range,
    inspector: { ...user, daily_target: daily, own_target: targets.byUser.has(uid) },
    totals: { ...tally(checks), target: daily * range.workingDays },
    days: tech.daysBetween(range.from, range.to).map((day) => ({
      day, working: tech.isWorkingDay(day), future: day > range.today, ...tally(checks.filter((c) => c.day === day)),
    })),
    checks: checks.map((c) => ({
      ticket_id: c.ticket_id,
      ttspl_id: c.ttspl_id,
      stage: c.stage,
      decision: c.decision,
      checked_at: c.checked_at,
      note: c.note,
      missed: c.missed,
      missed_at: c.missed_at,
      missed_how: c.missed_how,
      missed_ref: c.missed_ref,
      window_open: c.window_open,
      sales_order_number: c.sales_order_number,
    })),
  };
}

module.exports = {
  summary, inspectorDetail,
  getTargets: (db = pool) => tech.getTargets(db, 'qc'),
  saveTargets: (db, body, actorId) => tech.saveTargets(db, body, actorId, 'qc'),
  QC2_WINDOW_DAYS, DISPATCH_WINDOW_DAYS,
};
