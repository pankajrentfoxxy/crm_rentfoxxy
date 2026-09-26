/**
 * Support issue insights (claude/carret-support.md rework C).
 *
 * Counts only laptops raised under the issue process (reported_issue_id set,
 * migration 348) — the issue used is what the technician found, else what was
 * reported. Answers: which issues we get most, on which models and vendors,
 * how soon after delivery, why (root cause), and — for faults the floor let
 * through — who prepared and QC'd the laptop, so the floor can be coached.
 *
 * Tickets raised before the process only appear in `older`, grouped by their
 * old label, as they are.
 */
const pool = require('../config/db');

const STAGES = ['Diagnosis', 'Assembly & Software', 'Final Testing'];
const QC_STAGES = ['QC1', 'QC2', 'Dispatch QC'];
const AGE_BUCKETS = [
  { key: '0-7', label: 'Within a week', max: 7 },
  { key: '8-30', label: '8–30 days', max: 30 },
  { key: '31-90', label: '1–3 months', max: 90 },
  { key: '91-180', label: '3–6 months', max: 180 },
  { key: '180+', label: 'Over 6 months', max: Infinity },
];

function periodFrom(days) {
  const d = Math.min(Math.max(parseInt(days, 10) || 90, 7), 730);
  return d;
}

/** One row per laptop under the process, with everything the report groups by. */
async function loadRows(db, { days, typeId }) {
  const params = [periodFrom(days)];
  let typeSql = '';
  if (Number(typeId)) {
    params.push(Number(typeId));
    typeSql = `AND COALESCE(i.found_type_id, i.reported_type_id) = $${params.length}`;
  }
  return (await db.query(
    `SELECT i.id, i.ticket_id, t.created_at AS raised_at,
            COALESCE(NULLIF(i.unique_serial_number, ''), i.ttspl_id, i.serial_number) AS ttspl,
            NULLIF(TRIM(CONCAT_WS(' ', i.brand, i.model)), '') AS model,
            ct.name AS type_name, cs.name AS subtype_name, ci.name AS issue_name,
            COALESCE(i.found_type_id, i.reported_type_id) AS type_id,
            COALESCE(i.found_subtype_id, i.reported_subtype_id) AS subtype_id,
            COALESCE(i.found_issue_id, i.reported_issue_id) AS issue_id,
            (i.found_issue_id IS NOT NULL) AS has_finding,
            rc.code AS cause_code, rc.name AS cause_name,
            rs.code AS fix_code, rs.name AS fix_name,
            v.business_name AS vendor,
            GREATEST(0, (t.created_at::date - COALESCE(vsn.delivered_at, vsn.dispatched_at)::date)) AS days_since_delivery,
            t.customer_name
       FROM support_ticket_items i
       JOIN support_tickets t ON t.id = i.ticket_id
       JOIN support_issue_catalog ct ON ct.catalog_id = COALESCE(i.found_type_id, i.reported_type_id)
       JOIN support_issue_catalog cs ON cs.catalog_id = COALESCE(i.found_subtype_id, i.reported_subtype_id)
       JOIN support_issue_catalog ci ON ci.catalog_id = COALESCE(i.found_issue_id, i.reported_issue_id)
       LEFT JOIN support_root_causes rc ON rc.cause_id = i.root_cause_id
       LEFT JOIN support_resolution_codes rs ON rs.code_id = i.resolution_code_id
       LEFT JOIN LATERAL (
         SELECT s.po_id, s.delivered_at, s.dispatched_at
           FROM vendor_serial_numbers s
          WHERE s.deleted_at IS NULL
            AND s.inventory_asset_code = COALESCE(NULLIF(i.unique_serial_number, ''), i.ttspl_id)
          ORDER BY s.serial_id DESC LIMIT 1
       ) vsn ON TRUE
       LEFT JOIN vendor_purchase_orders po ON po.po_id = vsn.po_id
       LEFT JOIN vendors v ON v.vendor_id = po.vendor_id
      WHERE i.item_type = 'complaint' AND i.reported_issue_id IS NOT NULL
        AND i.status <> 'cancelled'
        AND t.created_at >= NOW() - ($1::int * INTERVAL '1 day')
        ${typeSql}`,
    params
  )).rows;
}

function countBy(rows, keyFn, labelFn = keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    const cur = m.get(k) || { key: k, label: labelFn(r), count: 0, rows: [] };
    cur.count += 1;
    cur.rows.push(r);
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

const topIssue = (rows) => {
  const t = countBy(rows, (r) => r.issue_id, (r) => `${r.subtype_name} › ${r.issue_name}`)[0];
  return t ? { label: t.label, count: t.count } : null;
};
const strip = (groups, extra = () => ({})) => groups.map(({ rows, ...g }) => ({ ...g, ...extra(rows) }));

/**
 * Who prepared the laptop before it went to the customer: the technician at
 * each floor stage and the tester / checker at each QC, from the last floor
 * ticket before the support ticket.
 */
async function floorPeople(db, laptops) {
  if (!laptops.length) return [];
  const out = [];
  for (const l of laptops) {
    const stages = (await db.query(
      `SELECT DISTINCT ON (h.current_stage) h.current_stage AS stage, h.current_technician_id AS user_id,
              COALESCE(u.name, h.current_technician) AS name
         FROM production_ticket_history h
         LEFT JOIN users u ON u.user_id = h.current_technician_id
        WHERE h.ttspl_id = $1 AND h.created_at < $2 AND h.current_stage = ANY($3::text[])
          AND (h.current_technician_id IS NOT NULL OR h.current_technician IS NOT NULL)
        ORDER BY h.current_stage, h.created_at DESC`,
      [l.ttspl, l.raised_at, STAGES]
    )).rows;
    const qcs = (await db.query(
      `SELECT DISTINCT ON (q.qc_stage) q.qc_stage AS stage, q.tested_by, tu.name AS tested_name, q.checked_by, cu.name AS checked_name
         FROM qc_results q
         JOIN tickets tk ON tk.ticket_id = q.ticket_id
         LEFT JOIN users tu ON tu.user_id = q.tested_by
         LEFT JOIN users cu ON cu.user_id = q.checked_by
        WHERE tk.ttspl_id = $1 AND COALESCE(q.submitted_at, q.created_at) < $2 AND q.qc_stage = ANY($3::text[])
        ORDER BY q.qc_stage, COALESCE(q.submitted_at, q.created_at) DESC`,
      [l.ttspl, l.raised_at, QC_STAGES]
    )).rows;
    const people = [
      ...stages.map((s) => ({ role: s.stage, user_id: s.user_id, name: s.name })),
      ...qcs.flatMap((q) => [
        q.tested_by ? { role: `${q.stage} tested`, user_id: q.tested_by, name: q.tested_name } : null,
        q.checked_by ? { role: `${q.stage} checked`, user_id: q.checked_by, name: q.checked_name } : null,
      ].filter(Boolean)),
    ];
    out.push({ ...l, people });
  }
  return out;
}

async function issueInsights({ days = 90, typeId = null } = {}, db = pool) {
  const rows = await loadRows(db, { days, typeId });
  const withFinding = rows.filter((r) => r.has_finding);
  const early = rows.filter((r) => r.days_since_delivery != null && r.days_since_delivery <= 30);

  // Floor feedback: the technician said the fault was missed at refurbishment,
  // or it failed within 30 days of delivery with a hardware cause.
  const floorCases = rows.filter((r) => r.cause_code === 'RC-REF'
    || (r.days_since_delivery != null && r.days_since_delivery <= 30 && ['RC-HWF', 'RC-MFD', 'RC-REF'].includes(r.cause_code)));
  const traced = await floorPeople(db, floorCases.slice(0, 200));
  const byPerson = new Map();
  for (const l of traced) {
    for (const p of l.people) {
      const k = `${p.user_id || p.name}`;
      const cur = byPerson.get(k) || { user_id: p.user_id, name: p.name || '—', roles: new Set(), laptops: [] };
      cur.roles.add(p.role);
      if (!cur.laptops.some((x) => x.id === l.id)) {
        cur.laptops.push({ id: l.id, ticket_id: l.ticket_id, ttspl: l.ttspl, model: l.model, issue: `${l.subtype_name} › ${l.issue_name}`, cause: l.cause_name, days: l.days_since_delivery });
      }
      byPerson.set(k, cur);
    }
  }

  const ageOf = (d) => (d == null ? null : AGE_BUCKETS.find((b) => d <= b.max).key);

  const older = (await db.query(
    `SELECT COALESCE(NULLIF(i.issue_category_label, ''), 'Not recorded') AS label, COUNT(*)::int AS count
       FROM support_ticket_items i JOIN support_tickets t ON t.id = i.ticket_id
      WHERE i.item_type = 'complaint' AND i.reported_issue_id IS NULL
        AND t.created_at >= NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    [periodFrom(days)]
  )).rows;

  return {
    days: periodFrom(days),
    summary: {
      laptops: rows.length,
      finding_recorded: withFinding.length,
      no_fault_found: withFinding.filter((r) => r.fix_code === 'RES-NFF').length,
      early_failures: early.length,
      floor_cases: floorCases.length,
    },
    by_type: strip(countBy(rows, (r) => r.type_id, (r) => r.type_name), (g) => ({ top: topIssue(g) })),
    by_issue: strip(countBy(rows, (r) => r.issue_id, (r) => `${r.type_name} › ${r.subtype_name} › ${r.issue_name}`)).slice(0, 20),
    by_model: strip(countBy(rows, (r) => r.model || 'Unknown model'), (g) => ({ top: topIssue(g) })).slice(0, 15),
    by_vendor: strip(countBy(rows, (r) => r.vendor || 'Our own stock / unknown'), (g) => ({ top: topIssue(g) })),
    by_age: AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: rows.filter((r) => ageOf(r.days_since_delivery) === b.key).length })),
    by_cause: strip(countBy(withFinding, (r) => r.cause_code, (r) => r.cause_name)),
    by_fix: strip(countBy(withFinding, (r) => r.fix_code, (r) => r.fix_name)),
    floor: [...byPerson.values()]
      .map((p) => ({ ...p, roles: [...p.roles], count: p.laptops.length }))
      .sort((a, b) => b.count - a.count),
    older,
  };
}

module.exports = { issueInsights, AGE_BUCKETS };
