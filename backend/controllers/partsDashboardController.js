/**
 * Spare-parts analytics.
 *
 * Everything here reads `part_movements`, the append-only ledger, rather than
 * the mutable `parts.quantity` counter or `part_instances.status`. That is what
 * lets "how many parts went into laptops today" and "what did we receive this
 * week, by category" be exact, and lets every number drill through to the
 * actual units and the laptops they landed on.
 */
const pool = require('../config/db');

const DEFAULT_TZ = 'Asia/Kolkata';
const DEFAULT_RANGE_DAYS = 30;

const METRIC_FILTERS = {
  received: `m.movement_type = 'received'`,
  installed: `m.movement_type = 'installed'`,
  installed_upgrade: `m.movement_type = 'installed' AND m.is_upgrade = TRUE`,
  installed_replacement: `m.movement_type = 'installed' AND m.is_upgrade = FALSE`,
  returned_defective: `m.movement_type = 'returned_defective'`,
  returned_good: `m.movement_type = 'returned_good'`,
  reserved: `m.movement_type = 'reserved'`,
  discarded: `m.movement_type = 'discarded'`,
};

function resolveRange(query) {
  const tz = String(query.tz || DEFAULT_TZ);
  const to = query.to ? String(query.to) : new Date().toISOString().slice(0, 10);
  let from = query.from ? String(query.from) : null;
  if (!from) {
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (DEFAULT_RANGE_DAYS - 1));
    from = d.toISOString().slice(0, 10);
  }
  return { from, to, tz };
}

/**
 * Ledger rows inside the range, in the caller's timezone. `to` is inclusive of
 * the whole day.
 */
const RANGE_CLAUSE = `
  (m.occurred_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
`;

// GET /api/parts/dashboard?from=&to=&tz=&category=
exports.getPartsDashboard = async (req, res) => {
  try {
    const { from, to, tz } = resolveRange(req.query);
    const category = String(req.query.category || '').trim() || null;
    const params = [from, to, tz];
    let categoryClause = '';
    if (category) {
      params.push(category);
      categoryClause = ` AND m.category = $${params.length}`;
    }
    const where = `WHERE ${RANGE_CLAUSE}${categoryClause}`;

    const [totals, series, byCategory, topParts, stock, recent] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE m.movement_type = 'received')                                 AS received,
           COUNT(*) FILTER (WHERE m.movement_type = 'installed')                                AS installed,
           COUNT(*) FILTER (WHERE m.movement_type = 'installed' AND m.is_upgrade)               AS installed_upgrade,
           COUNT(*) FILTER (WHERE m.movement_type = 'installed' AND NOT m.is_upgrade)           AS installed_replacement,
           COUNT(*) FILTER (WHERE m.movement_type = 'returned_defective')                       AS returned_defective,
           COUNT(*) FILTER (WHERE m.movement_type = 'returned_good')                            AS returned_good,
           COUNT(*) FILTER (WHERE m.movement_type = 'discarded')                                AS discarded,
           COUNT(DISTINCT m.ttspl_id) FILTER (WHERE m.movement_type = 'installed')              AS laptops_touched,
           COALESCE(SUM(m.unit_cost * m.quantity) FILTER (WHERE m.movement_type = 'received'), 0)::numeric  AS value_received,
           COALESCE(SUM(m.unit_cost * m.quantity) FILTER (WHERE m.movement_type = 'installed'), 0)::numeric AS value_installed
         FROM part_movements m ${where}`,
        params
      ),
      pool.query(
        // `day` is emitted as text so the client can echo it straight back into
        // the drill-down without a timezone round-trip shifting the date.
        `SELECT TO_CHAR((m.occurred_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day,
                COUNT(*) FILTER (WHERE m.movement_type = 'received')           AS received,
                COUNT(*) FILTER (WHERE m.movement_type = 'installed')          AS installed,
                COUNT(*) FILTER (WHERE m.movement_type = 'returned_defective') AS returned_defective
           FROM part_movements m ${where}
          GROUP BY 1 ORDER BY 1 ASC`,
        params
      ),
      pool.query(
        `SELECT COALESCE(m.category, 'general') AS category,
                COUNT(*) FILTER (WHERE m.movement_type = 'received')                       AS received,
                COUNT(*) FILTER (WHERE m.movement_type = 'installed')                      AS installed,
                COUNT(*) FILTER (WHERE m.movement_type = 'installed' AND m.is_upgrade)     AS upgrade,
                COUNT(*) FILTER (WHERE m.movement_type = 'installed' AND NOT m.is_upgrade) AS replacement,
                COUNT(*) FILTER (WHERE m.movement_type = 'returned_defective')             AS returned_defective,
                COALESCE(SUM(m.unit_cost * m.quantity) FILTER (WHERE m.movement_type = 'installed'), 0)::numeric AS value_installed
           FROM part_movements m ${where}
          GROUP BY 1 ORDER BY installed DESC, received DESC`,
        params
      ),
      pool.query(
        `SELECT m.part_id, COALESCE(m.part_name, 'Unknown') AS part_name,
                COALESCE(m.category, 'general') AS category,
                COUNT(*) FILTER (WHERE m.movement_type = 'installed') AS installed,
                COUNT(*) FILTER (WHERE m.movement_type = 'received')  AS received,
                COALESCE(SUM(m.unit_cost * m.quantity) FILTER (WHERE m.movement_type = 'installed'), 0)::numeric AS value_installed
           FROM part_movements m ${where}
          GROUP BY 1, 2, 3
         HAVING COUNT(*) FILTER (WHERE m.movement_type = 'installed') > 0
          ORDER BY installed DESC LIMIT 12`,
        params
      ),
      // Current snapshot — deliberately not date-filtered.
      pool.query(
        `SELECT COALESCE(p.category, 'general') AS category,
                COUNT(*) FILTER (WHERE pi.status = 'in_stock')  AS in_stock,
                COUNT(*) FILTER (WHERE pi.status = 'reserved')  AS reserved,
                COUNT(*) FILTER (WHERE pi.status = 'defective') AS defective,
                COALESCE(SUM(pi.unit_cost) FILTER (WHERE pi.status = 'in_stock'), 0)::numeric AS stock_value
           FROM part_instances pi JOIN parts p ON p.part_id = pi.part_id
          GROUP BY 1 ORDER BY in_stock DESC`
      ),
      pool.query(
        `SELECT m.movement_type, m.prt_id, m.part_name, m.category, m.serial_number,
                m.ttspl_id, m.ticket_id, m.is_upgrade, m.unit_cost, m.part_condition,
                m.actor_name, m.occurred_at
           FROM part_movements m ${where}
          ORDER BY m.occurred_at DESC, m.movement_id DESC LIMIT 25`,
        params
      ),
    ]);

    const t = totals.rows[0] || {};
    res.json({
      success: true,
      range: { from, to, tz, category },
      totals: {
        received: Number(t.received || 0),
        installed: Number(t.installed || 0),
        installed_upgrade: Number(t.installed_upgrade || 0),
        installed_replacement: Number(t.installed_replacement || 0),
        returned_defective: Number(t.returned_defective || 0),
        returned_good: Number(t.returned_good || 0),
        discarded: Number(t.discarded || 0),
        laptops_touched: Number(t.laptops_touched || 0),
        value_received: Number(t.value_received || 0),
        value_installed: Number(t.value_installed || 0),
      },
      series: series.rows.map((r) => ({
        day: r.day,
        received: Number(r.received || 0),
        installed: Number(r.installed || 0),
        returned_defective: Number(r.returned_defective || 0),
      })),
      by_category: byCategory.rows.map((r) => ({
        category: r.category,
        received: Number(r.received || 0),
        installed: Number(r.installed || 0),
        upgrade: Number(r.upgrade || 0),
        replacement: Number(r.replacement || 0),
        returned_defective: Number(r.returned_defective || 0),
        value_installed: Number(r.value_installed || 0),
      })),
      top_parts: topParts.rows.map((r) => ({
        part_id: r.part_id,
        part_name: r.part_name,
        category: r.category,
        installed: Number(r.installed || 0),
        received: Number(r.received || 0),
        value_installed: Number(r.value_installed || 0),
      })),
      stock_by_category: stock.rows.map((r) => ({
        category: r.category,
        in_stock: Number(r.in_stock || 0),
        reserved: Number(r.reserved || 0),
        defective: Number(r.defective || 0),
        stock_value: Number(r.stock_value || 0),
      })),
      recent: recent.rows,
    });
  } catch (err) {
    console.error('getPartsDashboard:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/parts/dashboard/drilldown?metric=installed&from=&to=&day=&category=&part_id=
// Every number on the dashboard resolves to the actual units behind it.
exports.getPartsDashboardDrilldown = async (req, res) => {
  try {
    const { from, to, tz } = resolveRange(req.query);
    const metric = String(req.query.metric || 'installed');
    const filter = METRIC_FILTERS[metric];
    if (!filter) {
      return res.status(400).json({
        success: false,
        message: `Unknown metric "${metric}". Expected one of: ${Object.keys(METRIC_FILTERS).join(', ')}`,
      });
    }

    const params = [from, to, tz];
    const clauses = [RANGE_CLAUSE, filter];

    if (req.query.day) {
      params.push(String(req.query.day));
      clauses.push(`(m.occurred_at AT TIME ZONE $3)::date = $${params.length}::date`);
    }
    if (req.query.category) {
      params.push(String(req.query.category));
      clauses.push(`m.category = $${params.length}`);
    }
    if (req.query.part_id) {
      params.push(Number(req.query.part_id));
      clauses.push(`m.part_id = $${params.length}`);
    }

    params.push(Math.min(1000, Number(req.query.limit) || 300));

    const r = await pool.query(
      `SELECT m.movement_id, m.movement_type, m.occurred_at,
              m.prt_id, m.part_id, m.part_name, m.category, m.serial_number,
              m.quantity, m.unit_cost, m.is_upgrade, m.part_condition, m.notes,
              m.actor_name, m.request_id, m.spo_id,
              m.ticket_id, m.ttspl_id,
              t.brand AS laptop_brand, t.model AS laptop_model,
              t.serial_number AS laptop_serial, t.current_stage_id,
              pr.request_number,
              spo.purchase_order_number
         FROM part_movements m
         LEFT JOIN tickets t       ON t.ticket_id = m.ticket_id
         LEFT JOIN part_requests pr ON pr.request_id = m.request_id
         LEFT JOIN vendor_spare_parts_purchase_orders spo ON spo.spo_id = m.spo_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY m.occurred_at DESC, m.movement_id DESC
        LIMIT $${params.length}`,
      params
    );

    res.json({
      success: true,
      metric,
      range: { from, to, tz },
      count: r.rows.length,
      rows: r.rows,
    });
  } catch (err) {
    console.error('getPartsDashboardDrilldown:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
