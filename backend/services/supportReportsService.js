'use strict';

/**
 * FCR = resolved with exactly one work order and no reopen within 7 days.
 * On-time arrival = on_site_at <= slot_end.
 * Reported-vs-found accuracy = lines where reported_subtype_id = found_subtype_id,
 *   over lines with both set.
 * MTBF by model = complaints per unit per year for that model, over fleet-days deployed.
 * TCO per TTSPL = parts + field visit cost + rent waived, over the asset's life.
 */

const REPORTS = {
  volume: `
    SELECT channel, ticket_class, type_code, subtype_code, issue_code, issue_label,
           customer_id, customer_name, city, COUNT(*)::int AS n
      FROM support_v2_rpt_volume
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY 1,2,3,4,5,6,7,8,9
     ORDER BY n DESC
     LIMIT 500`,
  sla: `
    SELECT
      ROUND(100 * AVG(CASE WHEN response_met THEN 1 ELSE 0 END)::numeric, 1) AS response_pct,
      ROUND(100 * AVG(CASE WHEN resolution_met THEN 1 ELSE 0 END)::numeric, 1) AS resolution_pct,
      ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, closed_at) - sla_started_at)) / 3600)::numeric, 1) AS avg_hours,
      SUM(sla_paused_minutes)::int AS paused_minutes,
      COUNT(*) FILTER (WHERE sla_resolution_breached) ::int AS breaches,
      json_agg(json_build_object('reason', COALESCE(breach_reason, 'NOT_YET_GIVEN'), 'n', 1))
        FILTER (WHERE sla_resolution_breached) AS breach_rows
      FROM support_v2_rpt_sla
     WHERE sla_started_at >= $1 AND sla_started_at < $2`,
  quality: `
    SELECT
      ROUND(100 * AVG(CASE WHEN is_fcr THEN 1 ELSE 0 END)::numeric, 1) AS fcr_pct,
      ROUND(100 * AVG(CASE WHEN COALESCE(reopen_count,0) > 0 THEN 1 ELSE 0 END)::numeric, 1) AS reopen_rate,
      ROUND(AVG(accuracy)::numeric, 3) AS accuracy
      FROM support_v2_rpt_quality
     WHERE COALESCE(resolved_at, closed_at, created_at) >= $1
       AND COALESCE(resolved_at, closed_at, created_at) < $2`,
  field: `
    SELECT
      assigned_to,
      (on_site_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
      COUNT(*)::int AS jobs,
      ROUND(100 * AVG(CASE WHEN on_time_arrival THEN 1 ELSE 0 END)::numeric, 1) AS on_time_pct,
      ROUND(AVG(time_spent_minutes)::numeric, 1) AS avg_on_site_minutes,
      ROUND(100 * AVG(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END)::numeric, 1) AS failed_pct,
      ROUND(100 * AVG(photo_compliance)::numeric, 1) AS photo_compliance_pct,
      failure_reason
      FROM support_v2_rpt_field
     WHERE COALESCE(completed_at, on_site_at, slot_start) >= $1
       AND COALESCE(completed_at, on_site_at, slot_start) < $2
     GROUP BY assigned_to, ((on_site_at AT TIME ZONE 'Asia/Kolkata')::date), failure_reason
     ORDER BY day DESC
     LIMIT 500`,
  assets: `
    SELECT brand, model,
           COUNT(*)::int AS complaints,
           COUNT(DISTINCT serial_id)::int AS units,
           ROUND((COUNT(*)::numeric / NULLIF(COUNT(DISTINCT serial_id), 0)), 2) AS complaints_per_unit,
           COUNT(*) FILTER (WHERE is_repeat)::int AS repeat_offenders
      FROM support_v2_rpt_assets
     WHERE complaint_at >= $1 AND complaint_at < $2
     GROUP BY 1,2
     ORDER BY complaints DESC
     LIMIT 200`,
  parts: `
    SELECT
      COUNT(*)::int AS requests,
      COUNT(*) FILTER (WHERE status_v2 = 'CONSUMED')::int AS consumed,
      COUNT(*) FILTER (WHERE unused_return)::int AS unused_returns,
      ROUND(AVG(approval_minutes)::numeric, 1) AS avg_approval_minutes,
      customer_id,
      SUM(charge_amount)::numeric AS cost
      FROM support_v2_rpt_parts
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY customer_id
     ORDER BY cost DESC NULLS LAST
     LIMIT 200`,
  commercial: `
    SELECT charge_type, status,
           COUNT(*)::int AS n,
           SUM(amount)::numeric AS amount,
           SUM(rent_waived_days)::numeric AS rent_waived_days
      FROM support_v2_rpt_commercial
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY 1,2
     ORDER BY 1,2`,
};

const QUALITY_DETAIL = `
  SELECT ticket_id, ticket_number, assigned_to, csat_score, is_fcr, accuracy, reopen_count
    FROM support_v2_rpt_quality
   WHERE csat_score IS NOT NULL AND csat_score <= 2
     AND COALESCE(resolved_at, closed_at, NOW()) >= $1
     AND COALESCE(resolved_at, closed_at, NOW()) < $2
   ORDER BY csat_score, ticket_id
   LIMIT 100`;

const VOLUME_TOP_ISSUES = `
  SELECT issue_code, issue_label, COUNT(*)::int AS n
    FROM support_v2_rpt_volume
   WHERE created_at >= $1 AND created_at < $2 AND issue_code IS NOT NULL
   GROUP BY 1,2
   ORDER BY n DESC
   LIMIT 20`;

const ASSET_TCO = `
  SELECT a.ttspl_id, a.brand, a.model,
         COALESCE(SUM(pr.charge_amount), 0) AS parts_cost,
         COUNT(DISTINCT a.line_id)::int AS complaints
    FROM support_v2_rpt_assets a
    LEFT JOIN part_requests pr ON pr.support_ticket_id = a.ticket_id
   WHERE a.ttspl_id IS NOT NULL
   GROUP BY 1,2,3
   ORDER BY parts_cost DESC
   LIMIT 50`;

function monthRange(from, to) {
  const start = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const end = to ? new Date(to) : new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return { start, end };
}

async function runReport(db, name, { from, to } = {}) {
  const sql = REPORTS[name];
  if (!sql) {
    const err = new Error('Unknown report');
    err.status = 404;
    throw err;
  }
  const { start, end } = monthRange(from, to);
  const r = await db.query(sql, [start, end]);
  const extra = {};
  if (name === 'volume') {
    extra.top_issues = (await db.query(VOLUME_TOP_ISSUES, [start, end])).rows;
  }
  if (name === 'quality') {
    extra.csat_low = (await db.query(QUALITY_DETAIL, [start, end])).rows;
    extra.csat = (await db.query(
      `SELECT csat_score, COUNT(*)::int AS n
         FROM support_v2_rpt_quality
        WHERE csat_score IS NOT NULL
          AND COALESCE(resolved_at, closed_at, created_at) >= $1
          AND COALESCE(resolved_at, closed_at, created_at) < $2
        GROUP BY 1 ORDER BY 1`,
      [start, end]
    )).rows;
  }
  if (name === 'assets') {
    extra.tco = (await db.query(ASSET_TCO)).rows;
  }
  if (name === 'sla') {
    const row = r.rows[0] || {};
    const reasons = {};
    for (const b of row.breach_rows || []) {
      reasons[b.reason] = (reasons[b.reason] || 0) + 1;
    }
    return {
      rows: [{
        response_pct: row.response_pct,
        resolution_pct: row.resolution_pct,
        avg_hours: row.avg_hours,
        paused_minutes: row.paused_minutes,
        breaches: row.breaches,
      }],
      by_reason: Object.entries(reasons).map(([reason, n]) => ({ reason, n })),
    };
  }
  return { rows: r.rows, ...extra };
}

module.exports = { runReport, REPORTS: Object.keys(REPORTS), monthRange };
