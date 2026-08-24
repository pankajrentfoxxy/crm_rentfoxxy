const pool = require('../config/db');
const { EWAY_VALUE_THRESHOLD } = require('../services/saleDcComplianceService');

const PENDING_DC_INVOICE_WHERE = `
  COALESCE(dcl.movement_type, 'outbound') = 'outbound'
  AND LOWER(COALESCE(dcl.status, '')) NOT IN ('cancelled')
  AND (
    LOWER(COALESCE(sol.quotation_type, '')) IN ('sale', 'sales')
    OR LOWER(COALESCE(dcl.entity_code, '')) = 'gorefurbo'
    OR (
      dcl.customer_id IS NOT NULL
      AND LOWER(COALESCE(dcl.status, '')) IN ('pending', 'processing', 'in_transit', 'reached', 'shipped')
      AND NOT EXISTS (
        SELECT 1 FROM sales_order_lines prior
         WHERE prior.customer_id = dcl.customer_id
           AND prior.sales_order_number IS DISTINCT FROM dcl.sales_order_number
           AND LOWER(COALESCE(prior.status, '')) NOT IN ('cancelled')
           AND prior.created_at < COALESCE(sol.created_at, dcl.created_at)
      )
    )
  )
  AND (
    COALESCE(NULLIF(TRIM(dcl.einvoice_number), ''), NULLIF(TRIM(dcl.irn), '')) IS NULL
    OR (
      NULLIF(TRIM(COALESCE(dcl.einvoice_pdf_path, '')), '') IS NULL
      AND NULLIF(TRIM(COALESCE(dcl.qr_code_url, '')), '') IS NULL
    )
    OR (
      COALESCE(dcl_amt.amount, 0) > ${EWAY_VALUE_THRESHOLD}
      AND (
        NULLIF(TRIM(COALESCE(dcl.eway_bill_number, '')), '') IS NULL
        OR NULLIF(TRIM(COALESCE(dcl.eway_bill_pdf_path, '')), '') IS NULL
      )
    )
  )
`;

const DC_INVOICE_FROM = `
  FROM delivery_challan_lines dcl
  LEFT JOIN LATERAL (
    SELECT quotation_type, created_at, customer_name
      FROM sales_order_lines
     WHERE sales_order_number = dcl.sales_order_number
     ORDER BY id ASC
     LIMIT 1
  ) sol ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(COALESCE(x.quantity, 0)), 0)::numeric AS dc_qty
      FROM delivery_challan_lines x
     WHERE x.dc_number = dcl.dc_number
  ) dcq ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(AVG(rate) FILTER (WHERE COALESCE(rate, 0) > 0), 0)::numeric AS unit_rate
      FROM sales_order_lines
     WHERE sales_order_number = dcl.sales_order_number
  ) sor ON TRUE
  LEFT JOIN LATERAL (
    SELECT ROUND((
      COALESCE(dcq.dc_qty, 0) * COALESCE(sor.unit_rate, 0)
    )::numeric, 2) AS amount
  ) dcl_amt ON TRUE
`;

exports.getCounts = async (req, res) => {
  try {
    const [draftRes, queueRes, dcInvRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM customer_invoices WHERE status = 'draft'`),
      pool.query(
        `SELECT COUNT(DISTINCT dcl.dc_number)::int AS c
         FROM delivery_challan_lines dcl
         LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
         LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
         WHERE dcl.status = 'delivered'
           AND dcl.irn IS NULL
           AND COALESCE(sol.quotation_type, sq.quotation_type) = 'sale'`
      ),
      pool.query(
        `SELECT COUNT(DISTINCT dcl.dc_number)::int AS c
         ${DC_INVOICE_FROM}
         WHERE ${PENDING_DC_INVOICE_WHERE}`
      ),
    ]);
    res.json({
      success: true,
      draft_invoices: draftRes.rows[0]?.c || 0,
      einvoice_queue: queueRes.rows[0]?.c || 0,
      dc_invoice_queue: dcInvRes.rows[0]?.c || 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const [
      invStats,
      vendorStats,
      cnPending,
      dnPending,
      einvoiceQueue,
      monthlyRevenue,
      statusDist,
      pendingCnList,
      pendingDnList,
      recentVendorBills,
    ] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_count,
           COALESCE(SUM(grand_total) FILTER (WHERE status = 'draft'), 0) AS draft_total,
           COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
           COALESCE(SUM(grand_total) FILTER (WHERE status = 'sent'), 0) AS sent_total,
           MIN(sent_at) FILTER (WHERE status = 'sent') AS sent_oldest,
           COUNT(*) FILTER (WHERE status = 'paid' AND paid_at >= $1::date)::int AS paid_month_count,
           COALESCE(SUM(grand_total) FILTER (WHERE status = 'paid' AND paid_at >= $1::date), 0) AS paid_month_total,
           COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue_count,
           COALESCE(SUM(grand_total) FILTER (WHERE status = 'overdue'), 0) AS overdue_total
         FROM customer_invoices`,
        [monthStart]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'generated')::int AS pending_approval_count,
           COALESCE(SUM(total_payable) FILTER (WHERE status = 'generated'), 0) AS pending_approval_total,
           COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_unpaid_count,
           COALESCE(SUM(total_payable) FILTER (WHERE status = 'approved'), 0) AS approved_unpaid_total,
           COUNT(*) FILTER (WHERE status = 'paid' AND payment_date >= $1::date)::int AS paid_month_count,
           COALESCE(SUM(total_payable) FILTER (WHERE status = 'paid' AND payment_date >= $1::date), 0) AS paid_month_total
         FROM vendor_monthly_bills`,
        [monthStart]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS total_value
         FROM customer_credit_notes WHERE status = 'pending'`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS total_value
         FROM vendor_debit_notes WHERE status = 'pending'`
      ),
      pool.query(
        `SELECT COUNT(DISTINCT dcl.dc_number)::int AS count
         FROM delivery_challan_lines dcl
         LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
         LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
         WHERE dcl.status = 'delivered' AND dcl.irn IS NULL
           AND COALESCE(sol.quotation_type, sq.quotation_type) = 'sale'`
      ),
      pool.query(
        `SELECT invoice_year AS year, invoice_month AS month,
                COALESCE(SUM(grand_total) FILTER (WHERE status = 'paid'), 0) AS revenue
         FROM customer_invoices
         WHERE (invoice_year * 100 + invoice_month) >= (
           EXTRACT(YEAR FROM NOW() - INTERVAL '5 months')::int * 100
           + EXTRACT(MONTH FROM NOW() - INTERVAL '5 months')::int
         )
         GROUP BY invoice_year, invoice_month
         ORDER BY invoice_year, invoice_month`
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM customer_invoices
         GROUP BY status`
      ),
      pool.query(
        `SELECT cn.*, c.company_name AS customer_name
         FROM customer_credit_notes cn
         LEFT JOIN customers c ON c.customer_id = cn.customer_id
         WHERE cn.status = 'pending'
         ORDER BY cn.created_at DESC LIMIT 10`
      ),
      pool.query(
        `SELECT dn.*, COALESCE(v.business_name, v.first_name) AS vendor_name
         FROM vendor_debit_notes dn
         LEFT JOIN vendors v ON v.vendor_id = dn.vendor_id
         WHERE dn.status = 'pending'
         ORDER BY dn.created_at DESC LIMIT 10`
      ),
      pool.query(
        `SELECT vb.*, COALESCE(v.business_name, v.first_name) AS vendor_name
         FROM vendor_monthly_bills vb
         LEFT JOIN vendors v ON v.vendor_id = vb.vendor_id
         WHERE vb.status IN ('generated', 'approved')
         ORDER BY vb.bill_year DESC, vb.bill_month DESC LIMIT 10`
      ),
    ]);

    const inv = invStats.rows[0] || {};
    const vb = vendorStats.rows[0] || {};

    res.json({
      success: true,
      customer_invoices: {
        draft: { count: inv.draft_count || 0, total_value: inv.draft_total || 0 },
        sent_unpaid: {
          count: inv.sent_count || 0,
          total_value: inv.sent_total || 0,
          oldest_date: inv.sent_oldest,
        },
        paid_this_month: { count: inv.paid_month_count || 0, total_value: inv.paid_month_total || 0 },
        overdue: { count: inv.overdue_count || 0, total_value: inv.overdue_total || 0 },
      },
      vendor_bills: {
        pending_approval: { count: vb.pending_approval_count || 0, total_value: vb.pending_approval_total || 0 },
        approved_unpaid: { count: vb.approved_unpaid_count || 0, total_value: vb.approved_unpaid_total || 0 },
        paid_this_month: { count: vb.paid_month_count || 0, total_value: vb.paid_month_total || 0 },
      },
      credit_notes_pending: cnPending.rows[0] || { count: 0, total_value: 0 },
      debit_notes_pending: dnPending.rows[0] || { count: 0, total_value: 0 },
      einvoice_queue: einvoiceQueue.rows[0]?.count || 0,
      monthly_revenue: monthlyRevenue.rows,
      invoice_status_distribution: statusDist.rows,
      pending_credit_notes: pendingCnList.rows,
      pending_debit_notes: pendingDnList.rows,
      vendor_bills_queue: recentVendorBills.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getEinvoiceQueue = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (dcl.dc_number)
         dcl.dc_number,
         dcl.created_at,
         dcl.customer_name,
         dcl.customer_id,
         COALESCE(sol.quotation_type, sq.quotation_type) AS quotation_type,
         dcl.irn,
         dcl.eway_bill_number,
         dcl.status,
         COALESCE(SUM(sol.rate * sol.quantity) OVER (PARTITION BY dcl.dc_number), 0) AS amount
       FROM delivery_challan_lines dcl
       LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
       LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
       WHERE dcl.status = 'delivered'
         AND dcl.irn IS NULL
         AND COALESCE(sol.quotation_type, sq.quotation_type) = 'sale'
       ORDER BY dcl.dc_number, dcl.created_at DESC`
    );
    res.json({ success: true, queue: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDcInvoiceQueue = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (dcl.dc_number)
           dcl.dc_number,
           dcl.sales_order_number,
           dcl.created_at,
           dcl.status,
           COALESCE(dcl.customer_name, sol.customer_name) AS customer_name,
           dcl.customer_id,
           sol.quotation_type,
           dcl.entity_code,
           dcl.einvoice_number,
           dcl.einvoice_pdf_path,
           dcl.irn,
           dcl.eway_bill_number,
           dcl.eway_bill_pdf_path,
           dcl.accounts_notified_at,
           COALESCE(dcq.dc_qty, 0) AS quantity,
           COALESCE(dcl_amt.amount, 0) AS amount,
           (COALESCE(dcl_amt.amount, 0) > $1) AS requires_eway_bill
         ${DC_INVOICE_FROM}
         WHERE ${PENDING_DC_INVOICE_WHERE}
         ORDER BY dcl.dc_number, dcl.created_at DESC
       ) q
       ORDER BY created_at DESC NULLS LAST, dc_number DESC`,
      [EWAY_VALUE_THRESHOLD]
    );
    res.json({ success: true, queue: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
