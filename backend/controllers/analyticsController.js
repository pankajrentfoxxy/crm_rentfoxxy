const pool = require('../config/db');

// Get Dashboard Statistics
exports.getDashboardStats = async (req, res) => {
  try {
    // Total tickets
    // Total Laptops on Floor (Active Tickets, not completed)
    const totalTickets = await pool.query("SELECT COUNT(*) as count FROM tickets WHERE status = 'in_progress'");

    // Tickets by status
    const ticketsByStatus = await pool.query(
      `SELECT status, COUNT(*) as count 
       FROM tickets 
       GROUP BY status`
    );

    // Tickets by stage
    const ticketsByStage = await pool.query(
      `SELECT s.stage_name, s.stage_order, COUNT(t.ticket_id) as count
       FROM stages s
       LEFT JOIN tickets t ON s.stage_id = t.current_stage_id
       GROUP BY s.stage_id, s.stage_name, s.stage_order
       ORDER BY s.stage_order ASC`
    );

    // Recent tickets
    const recentTickets = await pool.query(
      `SELECT t.ticket_id, t.serial_number, t.brand, t.model, t.status, 
              t.created_at, s.stage_name, u.name as assigned_to
       FROM tickets t
       LEFT JOIN stages s ON t.current_stage_id = s.stage_id
       LEFT JOIN users u ON t.assigned_user_id = u.user_id
       ORDER BY t.created_at DESC
       LIMIT 10`
    );

    // Active team members
    const activeUsers = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE active = true'
    );

    // Average completion time (for completed tickets) - In Hours
    const avgCompletionTime = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at))/3600) as avg_hours
       FROM tickets
       WHERE status = 'completed' AND completed_at IS NOT NULL`
    );

    // Tickets by priority
    const ticketsByPriority = await pool.query(
      `SELECT priority, COUNT(*) as count 
       FROM tickets 
       GROUP BY priority`
    );

    res.json({
      success: true,
      stats: {
        totalTickets: parseInt(totalTickets.rows[0].count),
        activeUsers: parseInt(activeUsers.rows[0].count),
        activeUsers: parseInt(activeUsers.rows[0].count),
        avgCompletionHours: avgCompletionTime.rows[0].avg_hours ?
          parseFloat(avgCompletionTime.rows[0].avg_hours).toFixed(1) : 0,
        ticketsByStatus: ticketsByStatus.rows,
        ticketsByStage: ticketsByStage.rows,
        ticketsByPriority: ticketsByPriority.rows,
        recentTickets: recentTickets.rows
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching dashboard statistics'
    });
  }
};

// Get Team Performance
exports.getTeamPerformance = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.team_name,
              COUNT(CASE WHEN tk.status = 'in_progress' THEN 1 END) as active_tickets,
              COUNT(CASE WHEN tk.status = 'completed' THEN 1 END) as completed_tickets,
              COUNT(tk.ticket_id) as total_tickets
       FROM teams t
       LEFT JOIN tickets tk ON t.team_id = tk.assigned_team_id
       GROUP BY t.team_id, t.team_name
       ORDER BY total_tickets DESC`
    );

    res.json({
      success: true,
      teamPerformance: result.rows
    });
  } catch (error) {
    console.error('Get team performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching team performance'
    });
  }
};

function num(row, key) {
  return parseFloat(row?.[key] || 0);
}

function buildLast6Months(rows) {
  const now = new Date();
  const map = new Map(
    rows.map((r) => [`${r.invoice_year}-${r.invoice_month}`, r])
  );
  const out = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    const key = `${year}-${month}`;
    const row = map.get(key);
    out.push({
      month,
      year,
      invoiced: num(row, 'invoiced'),
      collected: num(row, 'collected'),
    });
  }
  return out;
}

async function fetchMonthRevenue(month, year) {
  const res = await pool.query(
    `SELECT COALESCE(SUM(grand_total), 0)::float AS invoiced,
            COALESCE(SUM(grand_total) FILTER (WHERE status = 'paid'), 0)::float AS collected,
            COALESCE(SUM(grand_total) FILTER (WHERE status NOT IN ('paid', 'cancelled')), 0)::float AS outstanding
     FROM customer_invoices
     WHERE invoice_month = $1 AND invoice_year = $2`,
    [month, year]
  );
  const row = res.rows[0] || {};
  return {
    invoiced: num(row, 'invoiced'),
    collected: num(row, 'collected'),
    outstanding: num(row, 'outstanding'),
  };
}

exports.getManagerDashboard = async (req, res) => {
  try {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const lastMonthDate = new Date(curYear, now.getMonth() - 1, 1);
    const lastMonth = lastMonthDate.getMonth() + 1;
    const lastYear = lastMonthDate.getFullYear();

    const [
      currentMonth,
      lastMonthRev,
      last6Res,
      inventoryRes,
      leadsStatusRes,
      leadsMetricsRes,
      floorRes,
      floorStagesRes,
      supportRes,
      vendorRes,
      pendingBillsRes,
    ] = await Promise.all([
      fetchMonthRevenue(curMonth, curYear),
      fetchMonthRevenue(lastMonth, lastYear),
      pool.query(
        `SELECT invoice_month, invoice_year,
                COALESCE(SUM(grand_total), 0)::float AS invoiced,
                COALESCE(SUM(grand_total) FILTER (WHERE status = 'paid'), 0)::float AS collected
         FROM customer_invoices
         WHERE (invoice_year * 12 + invoice_month) >=
               (EXTRACT(YEAR FROM NOW())::int * 12 + EXTRACT(MONTH FROM NOW())::int - 5)
         GROUP BY invoice_month, invoice_year
         ORDER BY invoice_year, invoice_month`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE qc_status = 'qc_passed' AND inventory_status = 'in_stock')::int AS qc_passed_available,
          COUNT(*) FILTER (WHERE inventory_status = 'out_stock')::int AS currently_rented,
          COUNT(*) FILTER (WHERE inventory_status = 'sold')::int AS sold,
          COUNT(*) FILTER (WHERE qc_status IN ('qc1', 'qc2', 'in_qc'))::int AS in_qc,
          COUNT(*) FILTER (
            WHERE serial_number IN (
              SELECT serial_number FROM tickets
              WHERE status NOT IN ('completed', 'qc_failed_return_vendor', 'cancelled')
            )
          )::int AS in_repair,
          COUNT(*) FILTER (WHERE qc_status = 'qc_failed_return_vendor')::int AS qc_failed
         FROM vendor_serial_numbers
         WHERE deleted_at IS NULL`
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM leads
         WHERE status NOT IN ('Gone', 'Rejected')
         GROUP BY status
         ORDER BY count DESC`
      ),
      pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('Gone', 'Rejected'))::int AS total_active,
          COUNT(*) FILTER (
            WHERE converted_at >= date_trunc('month', NOW())
          )::int AS converted_this_month,
          COUNT(*) FILTER (
            WHERE status NOT IN ('Gone', 'Rejected', 'Deal', 'Demo')
              AND follow_up_date IS NOT NULL
              AND follow_up_date < NOW()
          )::int AS follow_up_overdue
         FROM leads`
      ),
      pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('completed', 'qc_failed_return_vendor', 'cancelled'))::int AS active_tickets,
          COUNT(*) FILTER (WHERE highlighted = TRUE)::int AS highlighted,
          COALESCE(
            AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)
              FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL),
            0
          )::float AS avg_completion_hours
         FROM tickets`
      ),
      pool.query(
        `SELECT s.stage_name, COUNT(t.ticket_id)::int AS count
         FROM stages s
         LEFT JOIN tickets t ON t.current_stage_id = s.stage_id
           AND t.status NOT IN ('completed', 'qc_failed_return_vendor', 'cancelled')
         GROUP BY s.stage_id, s.stage_name, s.stage_order
         ORDER BY s.stage_order ASC`
      ),
      pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status IN ('open', 'new'))::int AS open,
          COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
          COUNT(*) FILTER (
            WHERE status IN ('closed', 'resolved')
              AND closed_at >= date_trunc('month', NOW())
          )::int AS closed_this_month
         FROM support_tickets`
      ),
      pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM vendors WHERE deleted_at IS NULL AND status = 'approved') AS total_active_vendors,
          COUNT(*) FILTER (WHERE vmb.status IN ('generated', 'approved'))::int AS pending_bills,
          COALESCE(SUM(vmb.total_payable) FILTER (WHERE vmb.status IN ('generated', 'approved')), 0)::float AS pending_bills_amount
         FROM vendor_monthly_bills vmb`
      ),
      pool.query(
        `SELECT v.business_name AS vendor_name,
                vmb.bill_month AS month,
                vmb.bill_year AS year,
                vmb.total_payable::float AS amount,
                vmb.status
         FROM vendor_monthly_bills vmb
         JOIN vendors v ON v.vendor_id = vmb.vendor_id
         WHERE vmb.status IN ('generated', 'approved')
         ORDER BY vmb.total_payable DESC
         LIMIT 5`
      ),
    ]);

    const inv = inventoryRes.rows[0] || {};
    const totalFleet = inv.total || 0;
    const rented = inv.currently_rented || 0;
    const utilisationPct = totalFleet > 0 ? parseFloat(((rented / totalFleet) * 100).toFixed(1)) : 0;
    const leadsMetrics = leadsMetricsRes.rows[0] || {};
    const floor = floorRes.rows[0] || {};
    const vendor = vendorRes.rows[0] || {};

    res.json({
      success: true,
      data: {
        revenue: {
          current_month: currentMonth,
          last_month: lastMonthRev,
          last_6_months: buildLast6Months(last6Res.rows),
        },
        inventory: {
          total: inv.total || 0,
          qc_passed_available: inv.qc_passed_available || 0,
          currently_rented: rented,
          sold: inv.sold || 0,
          in_qc: inv.in_qc || 0,
          in_repair: inv.in_repair || 0,
          qc_failed: inv.qc_failed || 0,
          utilisation_pct: utilisationPct,
        },
        leads: {
          total_active: leadsMetrics.total_active || 0,
          by_status: leadsStatusRes.rows,
          converted_this_month: leadsMetrics.converted_this_month || 0,
          follow_up_overdue: leadsMetrics.follow_up_overdue || 0,
        },
        floor: {
          active_tickets: floor.active_tickets || 0,
          highlighted: floor.highlighted || 0,
          avg_completion_hours: parseFloat((floor.avg_completion_hours || 0).toFixed(1)),
          by_stage: floorStagesRes.rows.map((r) => ({
            stage_name: r.stage_name,
            count: r.count,
          })),
        },
        support: {
          open: supportRes.rows[0]?.open || 0,
          in_progress: supportRes.rows[0]?.in_progress || 0,
          closed_this_month: supportRes.rows[0]?.closed_this_month || 0,
        },
        vendor: {
          total_active_vendors: vendor.total_active_vendors || 0,
          pending_bills: vendor.pending_bills || 0,
          pending_bills_amount: num(vendor, 'pending_bills_amount'),
          pending_bills_list: pendingBillsRes.rows,
        },
      },
    });
  } catch (error) {
    console.error('getManagerDashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching manager dashboard' });
  }
};

exports.getSalesDashboard = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const isSalesOnly = req.user.role === 'sales';
    const leadFilter = isSalesOnly ? 'AND l.assigned_user_id = $1' : '';
    const leadParams = isSalesOnly ? [userId] : [];

    const quotFilter = isSalesOnly
      ? `AND (sq.created_by = $1 OR l.assigned_user_id = $1)`
      : '';
    const quotParams = isSalesOnly ? [userId] : [];

    const [
      leadsStatusRes,
      leadsMetricsRes,
      quotRes,
      convRes,
    ] = await Promise.all([
      pool.query(
        `SELECT l.status, COUNT(*)::int AS count
         FROM leads l
         WHERE l.status NOT IN ('Gone', 'Rejected') ${leadFilter}
         GROUP BY l.status
         ORDER BY count DESC`,
        leadParams
      ),
      pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE l.status NOT IN ('Gone', 'Rejected'))::int AS total,
          COUNT(*) FILTER (
            WHERE l.follow_up_date IS NOT NULL
              AND l.follow_up_date::date = CURRENT_DATE
          )::int AS follow_up_today,
          COUNT(*) FILTER (
            WHERE l.status NOT IN ('Gone', 'Rejected', 'Deal', 'Demo')
              AND l.follow_up_date IS NOT NULL
              AND l.follow_up_date < NOW()
          )::int AS follow_up_overdue
         FROM leads l
         WHERE TRUE ${leadFilter}`,
        leadParams
      ),
      pool.query(
        `SELECT
          COUNT(DISTINCT sq.quotation_number) FILTER (
            WHERE sq.status IN ('sent', 'approved', 'pending')
              AND sq.created_at >= date_trunc('month', NOW())
          )::int AS sent_this_month,
          COUNT(DISTINCT sq.quotation_number) FILTER (
            WHERE sq.status = 'approved'
              AND sq.updated_at >= date_trunc('month', NOW())
          )::int AS approved_this_month
         FROM sales_quotations sq
         LEFT JOIN leads l ON l.lead_id = sq.source_lead_id
         WHERE TRUE ${quotFilter}`,
        quotParams
      ),
      pool.query(
        `SELECT
          COUNT(*) FILTER (
            WHERE l.converted_at >= date_trunc('month', NOW())
          )::int AS this_month,
          COUNT(*) FILTER (
            WHERE l.converted_at >= date_trunc('month', NOW() - interval '1 month')
              AND l.converted_at < date_trunc('month', NOW())
          )::int AS last_month
         FROM leads l
         WHERE l.converted_at IS NOT NULL ${leadFilter}`,
        leadParams
      ),
    ]);

    const quot = quotRes.rows[0] || {};
    const sent = quot.sent_this_month || 0;
    const approved = quot.approved_this_month || 0;
    const hitRate = sent > 0 ? parseFloat(((approved / sent) * 100).toFixed(1)) : 0;
    const leadsMetrics = leadsMetricsRes.rows[0] || {};
    const conv = convRes.rows[0] || {};

    res.json({
      success: true,
      data: {
        my_leads: {
          total: leadsMetrics.total || 0,
          by_status: leadsStatusRes.rows,
          follow_up_today: leadsMetrics.follow_up_today || 0,
          follow_up_overdue: leadsMetrics.follow_up_overdue || 0,
        },
        quotations: {
          sent_this_month: sent,
          approved_this_month: approved,
          hit_rate_pct: hitRate,
        },
        conversions: {
          this_month: conv.this_month || 0,
          last_month: conv.last_month || 0,
        },
        monthly_target: null,
      },
    });
  } catch (error) {
    console.error('getSalesDashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching sales dashboard' });
  }
};
