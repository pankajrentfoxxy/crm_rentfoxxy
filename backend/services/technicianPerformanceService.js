/**
 * Technician performance (migration 415; Production → Technician performance).
 *
 * Definitions — every number on the dashboard comes from these, from
 * production_ticket_history (the floor's own record of every move):
 *
 *   job        a laptop whose Final Testing was finished (Final Testing → QC1):
 *              the end of the hardware & software work (Diagnosis → Assembly &
 *              Software → Final Testing). Credited to the technician it was
 *              assigned to at that stage (previous_technician_id), falling back
 *              to whoever recorded the move.
 *   rework     a second (or later) Final Testing on the same floor ticket. It
 *              follows a QC failure or a send-back, so it is shown but never
 *              counts toward the target — redoing your own failed work earns no
 *              second credit.
 *   QC result  of a job, judged on what happened to that laptop between this
 *              Final Testing and its next one:
 *                failed   — it failed QC1, QC2 or Dispatch QC
 *                passed   — it went on through QC2 into stock, or through
 *                           Dispatch QC (and nothing failed)
 *                awaiting — neither yet (QC1 done counts as awaiting QC2)
 *   correct    jobs − failed. Awaiting jobs count as correct until QC says
 *              otherwise, and are flagged so a manager knows the figure can drop.
 *   target     daily target × working days (Mon–Sat, IST) in the period, up to
 *              today. A technician's own target overrides the default.
 *
 * Diagnosis and Assembly finished are shown per technician for context; they
 * do not change the job count.
 */
const pool = require('../config/db');

const QC_STAGES = ['QC1', 'QC2', 'Dispatch QC'];
const DIAGNOSIS_DONE_ACTIONS = [
  'Diagnosis Completed', 'Sent to Chip Level Repair', 'Sent to Body & Paint',
  'Entered Assembly & Software', 'Entered Chip Level Repair', 'Entered Body & Paint',
];

class PerformanceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const ymd = (d) => new Date(d).toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
const todayIst = () => ymd(new Date());

function parseDay(v, label) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new PerformanceError(`${label} must be a date (YYYY-MM-DD)`);
  }
  return s;
}

function daysBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
/** Mon–Sat: the floor's working week. */
const isWorkingDay = (day) => new Date(`${day}T00:00:00Z`).getUTCDay() !== 0;

function normaliseRange(fromRaw, toRaw) {
  const today = todayIst();
  const from = parseDay(fromRaw || today, 'from');
  const to = parseDay(toRaw || from, 'to');
  if (to < from) throw new PerformanceError('"to" is before "from"');
  if (daysBetween(from, to).length > 366) throw new PerformanceError('Pick a period of a year or less');
  // Targets accrue only for days that have happened (a week in progress is
  // judged on the days so far).
  const targetTo = to > today ? today : to;
  const workingDays = targetTo < from ? 0 : daysBetween(from, targetTo).filter(isWorkingDay).length;
  return { from, to, today, workingDays, inProgress: to >= today };
}

/**
 * Every job finished in [from, to] (IST days), with its QC result.
 * techId narrows to one technician.
 */
async function loadJobs(db, { from, to, techId = null }) {
  const params = [from, to, QC_STAGES];
  let techSql = '';
  if (techId) { params.push(Number(techId)); techSql = `AND j.tech_id = $${params.length}`; }
  const { rows } = await db.query(
    `WITH ft AS (
       SELECT h.id, h.ticket_id, h.ttspl_id, h.created_at,
              COALESCE(h.previous_technician_id, h.performed_by) AS tech_id,
              LAG(h.created_at) OVER (PARTITION BY h.ticket_id ORDER BY h.created_at, h.id) AS prev_at
         FROM production_ticket_history h
        WHERE h.previous_stage = 'Final Testing' AND h.current_stage = 'QC1'
     ),
     -- The same move written twice seconds apart (old and new screens) is one job.
     dedup AS (
       SELECT * FROM ft WHERE prev_at IS NULL OR created_at - prev_at > INTERVAL '2 minutes'
     ),
     j AS (
       SELECT d.*,
              ROW_NUMBER() OVER (PARTITION BY d.ticket_id ORDER BY d.created_at, d.id) AS attempt,
              LEAD(d.created_at) OVER (PARTITION BY d.ticket_id ORDER BY d.created_at, d.id) AS next_at
         FROM dedup d
     )
     SELECT j.id, j.ticket_id, j.ttspl_id, j.tech_id, j.created_at AS done_at, j.attempt,
            (j.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
            t.ticket_type, t.sales_order_number, s.stage_name AS stage_now,
            o.failed, o.passed, o.qc1_passed, o.failed_at_stage, o.fail_reason, o.failed_on
       FROM j
       LEFT JOIN tickets t ON t.ticket_id = j.ticket_id
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(BOOL_OR(h2.previous_stage = ANY($3::text[]) AND h2.action ILIKE '%failed%'), FALSE) AS failed,
           COALESCE(BOOL_OR((h2.previous_stage = 'QC2' AND h2.current_stage IN ('Pending Inventory', 'Inventory'))
                    OR (h2.previous_stage = 'Dispatch QC' AND h2.current_stage = 'Inventory')), FALSE) AS passed,
           COALESCE(BOOL_OR(h2.previous_stage = 'QC1' AND h2.action ILIKE '%passed%'), FALSE) AS qc1_passed,
           (ARRAY_AGG(h2.previous_stage ORDER BY h2.created_at)
              FILTER (WHERE h2.previous_stage = ANY($3::text[]) AND h2.action ILIKE '%failed%'))[1] AS failed_at_stage,
           (ARRAY_AGG(COALESCE(NULLIF(h2.failure_reason, ''), NULLIF(h2.remarks, '')) ORDER BY h2.created_at)
              FILTER (WHERE h2.previous_stage = ANY($3::text[]) AND h2.action ILIKE '%failed%'))[1] AS fail_reason,
           (ARRAY_AGG(h2.created_at ORDER BY h2.created_at)
              FILTER (WHERE h2.previous_stage = ANY($3::text[]) AND h2.action ILIKE '%failed%'))[1] AS failed_on
           FROM production_ticket_history h2
          WHERE h2.ticket_id = j.ticket_id
            AND h2.created_at > j.created_at
            AND (j.next_at IS NULL OR h2.created_at < j.next_at)
       ) o ON TRUE
      WHERE (j.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        ${techSql}
      ORDER BY j.created_at`,
    params
  );
  return rows.map((r) => ({
    ...r,
    rework: Number(r.attempt) > 1,
    qc: r.failed ? 'failed' : r.passed ? 'passed' : 'awaiting',
    awaiting_what: r.failed || r.passed ? null : (r.qc1_passed ? 'QC2 / Dispatch QC' : 'QC1'),
  }));
}

/** Diagnosis and Assembly finished per technician, for context. */
async function loadStageCounts(db, { from, to }) {
  const { rows } = await db.query(
    `SELECT COALESCE(previous_technician_id, performed_by) AS tech_id,
            COUNT(DISTINCT ticket_id) FILTER (WHERE previous_stage = 'Diagnosis' AND action = ANY($3::text[]))::int AS diagnosis,
            COUNT(DISTINCT ticket_id) FILTER (WHERE previous_stage = 'Assembly & Software' AND current_stage = 'Final Testing')::int AS assembly
       FROM production_ticket_history
      WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        AND previous_stage IN ('Diagnosis', 'Assembly & Software')
      GROUP BY 1`,
    [from, to, DIAGNOSIS_DONE_ACTIONS]
  );
  return new Map(rows.filter((r) => r.tech_id).map((r) => [Number(r.tech_id), r]));
}

/** Default + per-technician daily targets. */
async function loadTargets(db) {
  const { rows } = await db.query(
    `SELECT tt.user_id, tt.daily_target, tt.updated_at, u.name AS updated_by_name
       FROM technician_performance_targets tt
       LEFT JOIN users u ON u.user_id = tt.updated_by`
  );
  const def = rows.find((r) => r.user_id == null);
  return {
    default: def ? Number(def.daily_target) : 10,
    default_updated_at: def?.updated_at || null,
    default_updated_by: def?.updated_by_name || null,
    byUser: new Map(rows.filter((r) => r.user_id != null).map((r) => [Number(r.user_id), Number(r.daily_target)])),
  };
}

/**
 * The floor's hardware & software technicians: everyone on the team that owns
 * Diagnosis / Assembly / Final Testing, so a technician with no jobs still
 * shows (with a zero), plus anyone else credited with a job in the period.
 */
async function loadTechnicians(db, creditedIds) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.user_id, u.name, u.role, u.active
       FROM users u
      WHERE u.user_id = ANY($1::int[])
         OR (COALESCE(u.active, TRUE) AND u.role IN ('team_member', 'team_lead', 'technician') AND (
              u.team_id IN (SELECT team_id FROM stages WHERE stage_name IN ('Diagnosis', 'Assembly & Software', 'Final Testing'))
              OR EXISTS (SELECT 1 FROM user_teams ut
                          WHERE ut.user_id = u.user_id
                            AND ut.team_id IN (SELECT team_id FROM stages WHERE stage_name IN ('Diagnosis', 'Assembly & Software', 'Final Testing')))
            ))`,
    [creditedIds]
  );
  return rows;
}

function standing(correct, target) {
  if (!target) return { key: 'no_target', label: 'No target set' };
  if (correct > target) return { key: 'above', label: `Above target by ${correct - target}` };
  if (correct === target) return { key: 'on', label: 'On target' };
  return { key: 'below', label: `Below target by ${target - correct}` };
}

function tally(jobs) {
  const first = jobs.filter((j) => !j.rework);
  const failed = first.filter((j) => j.qc === 'failed').length;
  const passed = first.filter((j) => j.qc === 'passed').length;
  const awaiting = first.filter((j) => j.qc === 'awaiting').length;
  return {
    completed: first.length,
    passed,
    failed,
    awaiting,
    correct: first.length - failed,
    reworks: jobs.length - first.length,
    first_time_pass_rate: passed + failed ? Math.round((passed / (passed + failed)) * 100) : null,
  };
}

async function summary(db = pool, { from: fromRaw, to: toRaw } = {}) {
  const range = normaliseRange(fromRaw, toRaw);
  const [jobs, stageCounts, targets] = await Promise.all([
    loadJobs(db, range), loadStageCounts(db, range), loadTargets(db),
  ]);
  const credited = [...new Set([...jobs.map((j) => Number(j.tech_id)), ...stageCounts.keys()].filter(Boolean))];
  const people = await loadTechnicians(db, credited);

  const technicians = people.map((p) => {
    const mine = jobs.filter((j) => Number(j.tech_id) === Number(p.user_id));
    const t = tally(mine);
    const daily = targets.byUser.has(Number(p.user_id)) ? targets.byUser.get(Number(p.user_id)) : targets.default;
    const target = daily * range.workingDays;
    const sc = stageCounts.get(Number(p.user_id)) || {};
    return {
      user_id: p.user_id,
      name: p.name,
      role: p.role,
      active: p.active !== false,
      daily_target: daily,
      own_target: targets.byUser.has(Number(p.user_id)),
      target,
      ...t,
      diagnosis: sc.diagnosis || 0,
      assembly: sc.assembly || 0,
      vs_target: target ? t.correct - target : null,
      standing: standing(t.correct, target),
      // The incentive is earned on correct jobs; awaiting QC can still lower it.
      eligible: target > 0 && t.correct >= target,
      provisional: t.awaiting > 0,
    };
  })
    // Someone with nothing at all in the period and no longer active is noise.
    .filter((x) => x.active || x.completed || x.reworks || x.diagnosis || x.assembly)
    .sort((a, b) => (b.correct - a.correct) || (b.completed - a.completed) || String(a.name).localeCompare(String(b.name)));

  const days = daysBetween(range.from, range.to).map((day) => {
    const t = tally(jobs.filter((j) => j.day === day));
    return { day, working: isWorkingDay(day), future: day > range.today, ...t };
  });
  const team = tally(jobs);
  // The team's target and standing count only technicians who did floor work
  // in the period — an absent technician or a shared account (e.g. "AUDIT")
  // on the team must not inflate the target nobody worked against.
  const worked = technicians.filter((x) => x.completed || x.reworks || x.diagnosis || x.assembly);
  const teamTarget = worked.reduce((s, x) => s + x.target, 0);

  return {
    period: { ...range },
    definitions: {
      job: 'A laptop whose Final Testing was finished (Diagnosis → Assembly → Final Testing done).',
      correct: 'Jobs minus those that then failed QC1, QC2 or Dispatch QC.',
      rework: 'A second Final Testing on the same laptop after a failure — shown, not counted toward the target.',
      target: 'Daily target × working days (Mon–Sat) in the period, up to today. The team target adds up the technicians who worked in the period.',
    },
    default_daily_target: targets.default,
    team: {
      ...team,
      target: teamTarget,
      daily_target: worked.reduce((s, x) => s + x.daily_target, 0),
      technicians: worked.length,
      eligible: worked.filter((x) => x.eligible).length,
      above: worked.filter((x) => x.standing.key === 'above').length,
    },
    technicians,
    days,
  };
}

async function technicianDetail(db = pool, { userId, from: fromRaw, to: toRaw }) {
  const range = normaliseRange(fromRaw, toRaw);
  const uid = Number(userId);
  if (!uid) throw new PerformanceError('Technician is required');
  const user = (await db.query('SELECT user_id, name, role FROM users WHERE user_id = $1', [uid])).rows[0];
  if (!user) throw new PerformanceError('Technician not found', 404);
  const [jobs, targets] = await Promise.all([loadJobs(db, { ...range, techId: uid }), loadTargets(db)]);
  const daily = targets.byUser.has(uid) ? targets.byUser.get(uid) : targets.default;
  const days = daysBetween(range.from, range.to).map((day) => ({
    day,
    working: isWorkingDay(day),
    future: day > range.today,
    target: isWorkingDay(day) && day <= range.today ? daily : 0,
    ...tally(jobs.filter((j) => j.day === day)),
  }));
  return {
    period: range,
    technician: { ...user, daily_target: daily, own_target: targets.byUser.has(uid) },
    totals: { ...tally(jobs), target: daily * range.workingDays },
    days,
    jobs: jobs.map((j) => ({
      ticket_id: j.ticket_id,
      ttspl_id: j.ttspl_id,
      done_at: j.done_at,
      rework: j.rework,
      attempt: Number(j.attempt),
      qc: j.qc,
      awaiting_what: j.awaiting_what,
      failed_at_stage: j.failed_at_stage,
      failed_on: j.failed_on,
      fail_reason: j.fail_reason,
      stage_now: j.stage_now,
      sales_order_number: j.sales_order_number,
    })),
  };
}

async function getTargets(db = pool) {
  const t = await loadTargets(db);
  const { rows } = await db.query(
    `SELECT tt.user_id, u.name, tt.daily_target FROM technician_performance_targets tt
       JOIN users u ON u.user_id = tt.user_id ORDER BY u.name`
  );
  return { default_daily_target: t.default, updated_at: t.default_updated_at, updated_by: t.default_updated_by, per_technician: rows };
}

/**
 * body: { default_daily_target?, per_technician?: [{ user_id, daily_target|null }] }
 * null removes a technician's own target (they follow the default again).
 */
async function saveTargets(db, body = {}, actorId = null) {
  const num = (v, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 200) throw new PerformanceError(`${label} must be a whole number from 0 to 200`);
    return n;
  };
  if (body.default_daily_target !== undefined) {
    const n = num(body.default_daily_target, 'The default daily target');
    await db.query(
      `INSERT INTO technician_performance_targets (user_id, daily_target, updated_by, updated_at)
       VALUES (NULL, $1, $2, NOW())
       ON CONFLICT ((COALESCE(user_id, 0))) DO UPDATE SET daily_target = EXCLUDED.daily_target, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [n, actorId]
    );
  }
  for (const row of Array.isArray(body.per_technician) ? body.per_technician : []) {
    const uid = Number(row.user_id);
    if (!uid) continue;
    if (row.daily_target === null || row.daily_target === '') {
      await db.query('DELETE FROM technician_performance_targets WHERE user_id = $1', [uid]);
    } else {
      const n = num(row.daily_target, 'A daily target');
      await db.query(
        `INSERT INTO technician_performance_targets (user_id, daily_target, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT ((COALESCE(user_id, 0))) DO UPDATE SET daily_target = EXCLUDED.daily_target, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [uid, n, actorId]
      );
    }
  }
  return getTargets(db);
}

module.exports = {
  PerformanceError, summary, technicianDetail, getTargets, saveTargets,
  // exported for tests
  normaliseRange, tally, standing, isWorkingDay,
};
