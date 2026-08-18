'use strict';

const pool = require('../config/db');
const sla = require('../services/supportSlaService');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportSla:', e);
  return res.status(status).json({ success: false, message: e.message });
}

exports.listPolicies = async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, c.code AS calendar_code, c.name AS calendar_name,
              cu.name AS customer_name
         FROM support_sla_policies p
         JOIN support_business_calendars c ON c.calendar_id = p.calendar_id
         LEFT JOIN customers cu ON cu.customer_id = p.customer_id
        ORDER BY p.specificity DESC, p.priority ASC NULLS LAST, p.name`
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.createPolicy = async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO support_sla_policies (
         name, ticket_class, priority, support_tier, customer_id, calendar_id,
         response_minutes, resolution_minutes, specificity
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        b.name, b.ticket_class || 'BOTH', b.priority, b.support_tier || null,
        b.customer_id || null, b.calendar_id, b.response_minutes, b.resolution_minutes,
        b.specificity || 0,
      ]
    );
    res.status(201).json({ success: true, row: r.rows[0] });
  } catch (e) { bad(res, e); }
};

exports.patchPolicy = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const r = await pool.query(
      `UPDATE support_sla_policies SET
         name = COALESCE($2, name),
         ticket_class = COALESCE($3, ticket_class),
         priority = COALESCE($4, priority),
         support_tier = COALESCE($5, support_tier),
         customer_id = COALESCE($6, customer_id),
         calendar_id = COALESCE($7, calendar_id),
         response_minutes = COALESCE($8, response_minutes),
         resolution_minutes = COALESCE($9, resolution_minutes),
         specificity = COALESCE($10, specificity),
         active = COALESCE($11, active),
         updated_at = NOW()
       WHERE policy_id = $1
       RETURNING *`,
      [
        id, b.name, b.ticket_class, b.priority, b.support_tier, b.customer_id,
        b.calendar_id, b.response_minutes, b.resolution_minutes, b.specificity, b.active,
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, row: r.rows[0] });
  } catch (e) { bad(res, e); }
};

exports.listCalendars = async (_req, res) => {
  try {
    const cals = await pool.query(
      `SELECT * FROM support_business_calendars ORDER BY calendar_id`
    );
    const hours = await pool.query(`SELECT * FROM support_calendar_hours ORDER BY day_of_week`);
    const holidays = await pool.query(
      `SELECT * FROM support_holidays ORDER BY holiday_date`
    );
    const rows = cals.rows.map((c) => ({
      ...c,
      hours: hours.rows.filter((h) => h.calendar_id === c.calendar_id),
      holidays: holidays.rows.filter((h) => h.calendar_id === c.calendar_id),
    }));
    res.json({ success: true, rows });
  } catch (e) { bad(res, e); }
};

exports.addHoliday = async (req, res) => {
  try {
    const calendarId = Number(req.params.id);
    const { holiday_date, name } = req.body || {};
    const r = await pool.query(
      `INSERT INTO support_holidays (calendar_id, holiday_date, name)
       VALUES ($1,$2,$3)
       ON CONFLICT (calendar_id, holiday_date) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [calendarId, holiday_date, name]
    );
    res.status(201).json({ success: true, row: r.rows[0] });
  } catch (e) { bad(res, e); }
};

exports.preview = async (req, res) => {
  try {
    const result = await sla.previewSla(pool, req.body || {});
    res.json({ success: true, ...result });
  } catch (e) { bad(res, e); }
};

exports.breaches = async (_req, res) => {
  try {
    const kpis = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('RESOLVED','CLOSED')
           AND COALESCE(resolved_at, closed_at) >= date_trunc('month', NOW())) AS resolved_mtd,
         COUNT(*) FILTER (WHERE status IN ('RESOLVED','CLOSED')
           AND COALESCE(resolved_at, closed_at) >= date_trunc('month', NOW())
           AND COALESCE(sla_breached, FALSE) = FALSE) AS response_met,
         COUNT(*) FILTER (WHERE status IN ('RESOLVED','CLOSED')
           AND COALESCE(resolved_at, closed_at) >= date_trunc('month', NOW())
           AND COALESCE(sla_resolution_breached, FALSE) = FALSE) AS resolution_met,
         COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, closed_at) - created_at)) / 3600)
           FILTER (WHERE status IN ('RESOLVED','CLOSED')
             AND COALESCE(resolved_at, closed_at) >= date_trunc('month', NOW())), 0) AS avg_hours,
         COALESCE(SUM(sla_paused_minutes), 0) AS paused_minutes
         FROM support_tickets_v2`
    );
    const byPri = await pool.query(
      `SELECT priority,
              ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, closed_at) - created_at)) / 3600)::numeric, 1) AS avg_hours
         FROM support_tickets_v2
        WHERE status IN ('RESOLVED','CLOSED')
          AND COALESCE(resolved_at, closed_at) >= date_trunc('month', NOW())
        GROUP BY priority
        ORDER BY priority`
    );
    const byReason = await pool.query(
      `SELECT COALESCE(breach_reason, 'NOT_YET_GIVEN') AS reason, COUNT(*)::int AS n
         FROM support_tickets_v2
        WHERE sla_resolution_breached = TRUE
        GROUP BY 1
        ORDER BY n DESC`
    );
    const rows = await pool.query(
      `SELECT t.ticket_id, t.ticket_number, t.priority, t.status, t.breach_reason,
              t.sla_resolution_due_at, t.sla_resolution_breached,
              COALESCE(c.company_name, c.name) AS customer_name,
              EXTRACT(EPOCH FROM (NOW() - t.sla_resolution_due_at)) AS over_seconds
         FROM support_tickets_v2 t
         LEFT JOIN customers c ON c.customer_id = t.customer_id
        WHERE t.sla_resolution_breached = TRUE
        ORDER BY t.sla_resolution_due_at ASC NULLS LAST
        LIMIT 200`
    );
    const k = kpis.rows[0] || {};
    const resolved = Number(k.resolved_mtd || 0);
    res.json({
      success: true,
      kpis: {
        response_pct: resolved ? Math.round((Number(k.response_met || 0) / resolved) * 1000) / 10 : 100,
        resolution_pct: resolved ? Math.round((Number(k.resolution_met || 0) / resolved) * 1000) / 10 : 100,
        avg_hours_by_priority: byPri.rows,
        paused_minutes: Number(k.paused_minutes || 0),
      },
      by_reason: byReason.rows,
      rows: rows.rows,
    });
  } catch (e) { bad(res, e); }
};
