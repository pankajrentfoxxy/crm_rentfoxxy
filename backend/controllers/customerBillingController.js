const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { emailDocument } = require('../services/salesManagementPdfService');
const { ZipArchive } = require('archiver');
const { generateCustomerInvoicePdf, invoicePdfDownloadName, uniqueCustomerPdfName } = require('../services/customerInvoicePdfService');
const { normalizeInvoiceFormat, parseLineItems, enrichLineItemsWithSpecs } = require('../services/customerInvoiceHtmlService');
const {
  generateCustomerInvoice,
  generateAllCustomerInvoices,
  approveAndApplyCreditNote,
} = require('../services/billingSchedulerService');
const {
  listZohoCandidates,
  markInvoiceGeneratedOnZoho,
} = require('../services/billingZohoService');
const {
  recordPayment,
  recordFullPayment,
  listPayments,
} = require('../services/paymentLedgerService');

async function nextCreditNoteNumber() {
  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1
     WHERE doc_type = 'credit_note'
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  return res.rows[0].number;
}

// Exposed for tests / scripts.
exports._generateInvoicePdf = generateCustomerInvoicePdf;

exports.ensureBillingEngineSchema = async () => {
  const sqlPath = path.join(__dirname, '../migrations/067_phase5_billing_engine.sql');
  if (!fs.existsSync(sqlPath)) return;
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
};

const SECURITY_LINE_SQL = `(
  COALESCE(elem->>'line_type', 'rental') = 'security'
  OR LOWER(COALESCE(elem->>'is_security', 'false')) IN ('true', 't', '1', 'yes')
)`;
const CATCHUP_LINE_SQL = `(
  NOT ${SECURITY_LINE_SQL}
  AND LOWER(COALESCE(elem->>'is_catchup', 'false')) IN ('true', 't', '1', 'yes')
)`;
const THIS_MONTH_RENTAL_SQL = `(
  NOT ${SECURITY_LINE_SQL}
  AND LOWER(COALESCE(elem->>'is_catchup', 'false')) NOT IN ('true', 't', '1', 'yes')
)`;
const LINE_AMOUNT_SQL = `COALESCE(NULLIF(elem->>'amount', ''), '0')::numeric`;
const LINE_LAPTOP_KEY_SQL = `COALESCE(NULLIF(elem->>'serial_id', ''), NULLIF(elem->>'ttspl_id', ''), elem->>'serial_number')`;

function invoiceListFilters(query, { includeStatus = true } = {}) {
  const { customer_id, month, year, status, search } = query;
  const params = [];
  const where = ['1=1'];
  if (customer_id) {
    params.push(customer_id);
    where.push(`ci.customer_id = $${params.length}`);
  }
  if (month) {
    params.push(month);
    where.push(`ci.invoice_month = $${params.length}`);
  }
  if (year) {
    params.push(year);
    where.push(`ci.invoice_year = $${params.length}`);
  }
  if (includeStatus && status) {
    params.push(status);
    where.push(`ci.status = $${params.length}`);
  }
  const qSearch = String(search || '').trim();
  if (qSearch) {
    params.push(`%${qSearch}%`);
    const n = params.length;
    where.push(`(
      ci.invoice_number ILIKE $${n}
      OR COALESCE(c.company_name, '') ILIKE $${n}
      OR COALESCE(c.name, '') ILIKE $${n}
      OR COALESCE(ci.irn, '') ILIKE $${n}
    )`);
  }
  return { params, where };
}

exports.listInvoices = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const list = invoiceListFilters(req.query, { includeStatus: true });
    const kpi = invoiceListFilters(req.query, { includeStatus: false });
    if (String(req.query.status || '') !== 'cancelled') {
      kpi.where.push(`ci.status <> 'cancelled'`);
    }
    const kpiWhere = kpi.where.join(' AND ');
    list.params.push(limit, offset);

    const [listRes, countRes, summaryRes, securityRes, catchupRes, lineKpiRes, pendingCnRes] = await Promise.all([
      pool.query(
        `SELECT ci.*, c.company_name AS customer_name, c.email AS customer_email,
                COALESCE((
                  SELECT COUNT(*)::int
                  FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(ci.line_items) = 'array' THEN ci.line_items ELSE '[]'::jsonb END
                  ) elem
                  WHERE NOT ${SECURITY_LINE_SQL}
                ), 0) AS laptop_count,
                COALESCE((
                  SELECT COUNT(*)::int
                  FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(ci.line_items) = 'array' THEN ci.line_items ELSE '[]'::jsonb END
                  ) elem
                  WHERE ${SECURITY_LINE_SQL}
                ), 0) AS security_laptop_count,
                COALESCE((
                  SELECT SUM(COALESCE(NULLIF(elem->>'amount', ''), '0')::numeric)
                  FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(ci.line_items) = 'array' THEN ci.line_items ELSE '[]'::jsonb END
                  ) elem
                  WHERE ${SECURITY_LINE_SQL}
                ), 0) AS security_amount
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.customer_id = ci.customer_id
         WHERE ${list.where.join(' AND ')}
         ORDER BY ci.invoice_year DESC, ci.invoice_month DESC, ci.invoice_id DESC
         LIMIT $${list.params.length - 1} OFFSET $${list.params.length}`,
        list.params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.customer_id = ci.customer_id
         WHERE ${list.where.join(' AND ')}`,
        list.params.slice(0, list.params.length - 2)
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_count,
           COALESCE(SUM(ci.grand_total), 0) AS total_amount,
           COALESCE(SUM(ci.subtotal), 0) AS subtotal_total,
           COALESCE(SUM(ci.credit_note_adjustment), 0) AS credit_note_total,
           COUNT(*) FILTER (WHERE COALESCE(ci.credit_note_adjustment, 0) > 0)::int AS credit_note_invoice_count,
           COUNT(*) FILTER (WHERE ci.status = 'draft')::int AS draft_count,
           COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status = 'draft'), 0) AS draft_total,
           COUNT(*) FILTER (WHERE ci.status = 'sent')::int AS sent_count,
           COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status = 'sent'), 0) AS sent_total,
           COUNT(*) FILTER (WHERE ci.status = 'paid')::int AS paid_count,
           COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status = 'paid'), 0) AS paid_total,
           COUNT(*) FILTER (WHERE ci.status = 'overdue')::int AS overdue_count,
           COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status = 'overdue'), 0) AS overdue_total,
           COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status IN ('sent','overdue')), 0) AS outstanding_total
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.customer_id = ci.customer_id
         WHERE ${kpiWhere}`,
        kpi.params
      ),
      pool.query(
        `SELECT
           ci.customer_id,
           COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), 'Customer #' || ci.customer_id) AS customer_name,
           ci.invoice_id,
           ci.invoice_number,
           ci.status,
           ci.invoice_month,
           ci.invoice_year,
           COUNT(*)::int AS laptop_count,
           COALESCE(SUM(COALESCE(NULLIF(elem->>'amount', ''), '0')::numeric), 0) AS amount,
           json_agg(
             COALESCE(NULLIF(elem->>'ttspl_id', ''), NULLIF(elem->>'serial_number', ''), 'Laptop')
             ORDER BY COALESCE(NULLIF(elem->>'ttspl_id', ''), elem->>'serial_number')
           ) AS ttspls
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.customer_id = ci.customer_id
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(ci.line_items) = 'array' THEN ci.line_items ELSE '[]'::jsonb END
         ) elem
         WHERE ${kpiWhere}
           AND ${SECURITY_LINE_SQL}
         GROUP BY ci.customer_id, c.company_name, c.name, ci.invoice_id, ci.invoice_number,
                  ci.status, ci.invoice_month, ci.invoice_year
         ORDER BY customer_name, ci.invoice_number`,
        kpi.params
      ),
      pool.query(
        `SELECT
           ci.customer_id,
           COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), 'Customer #' || ci.customer_id) AS customer_name,
           ci.invoice_id,
           ci.invoice_number,
           ci.status,
           ci.invoice_month,
           ci.invoice_year,
           COUNT(*)::int AS laptop_count,
           COALESCE(SUM(${LINE_AMOUNT_SQL}), 0) AS amount,
           json_agg(
             COALESCE(NULLIF(elem->>'ttspl_id', ''), NULLIF(elem->>'serial_number', ''), 'Laptop')
             ORDER BY COALESCE(NULLIF(elem->>'ttspl_id', ''), elem->>'serial_number')
           ) AS ttspls
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.customer_id = ci.customer_id
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(ci.line_items) = 'array' THEN ci.line_items ELSE '[]'::jsonb END
         ) elem
         WHERE ${kpiWhere}
           AND ${CATCHUP_LINE_SQL}
         GROUP BY ci.customer_id, c.company_name, c.name, ci.invoice_id, ci.invoice_number,
                  ci.status, ci.invoice_month, ci.invoice_year
         ORDER BY customer_name, ci.invoice_number`,
        kpi.params
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(${LINE_AMOUNT_SQL}) FILTER (WHERE ${THIS_MONTH_RENTAL_SQL}), 0) AS this_month_rental_total,
           COUNT(*) FILTER (WHERE ${THIS_MONTH_RENTAL_SQL})::int AS this_month_line_count,
           COUNT(DISTINCT ${LINE_LAPTOP_KEY_SQL}) FILTER (WHERE ${THIS_MONTH_RENTAL_SQL})::int AS this_month_laptop_count,
           COUNT(DISTINCT ci.invoice_id) FILTER (WHERE ${THIS_MONTH_RENTAL_SQL})::int AS this_month_invoice_count,
           COALESCE(SUM(${LINE_AMOUNT_SQL}) FILTER (WHERE ${CATCHUP_LINE_SQL}), 0) AS catchup_total,
           COUNT(*) FILTER (WHERE ${CATCHUP_LINE_SQL})::int AS catchup_line_count,
           COUNT(DISTINCT ${LINE_LAPTOP_KEY_SQL}) FILTER (WHERE ${CATCHUP_LINE_SQL})::int AS catchup_laptop_count,
           COUNT(DISTINCT ci.invoice_id) FILTER (WHERE ${CATCHUP_LINE_SQL})::int AS catchup_invoice_count,
           COUNT(DISTINCT ci.customer_id) FILTER (WHERE ${CATCHUP_LINE_SQL})::int AS catchup_customer_count
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.customer_id = ci.customer_id
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(ci.line_items) = 'array' THEN ci.line_items ELSE '[]'::jsonb END
         ) elem
         WHERE ${kpiWhere}`,
        kpi.params
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(cn.amount), 0) AS pending_total,
           COUNT(*)::int AS pending_count
         FROM customer_credit_notes cn
         WHERE cn.status = 'pending'
           AND cn.invoice_id IN (
             SELECT ci.invoice_id
             FROM customer_invoices ci
             LEFT JOIN customers c ON c.customer_id = ci.customer_id
             WHERE ${kpiWhere}
           )`,
        kpi.params
      ),
    ]);

    const securityDetails = securityRes.rows || [];
    const catchupDetails = catchupRes.rows || [];
    const securityCustomers = new Set(securityDetails.map((row) => row.customer_id));
    const lineKpi = lineKpiRes.rows[0] || {};
    const thisMonthRental = Number(lineKpi.this_month_rental_total || 0);
    const catchupTotal = Number(lineKpi.catchup_total || 0);
    const securityTotal = securityDetails.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const summary = {
      ...(summaryRes.rows[0] || {}),
      this_month_rental_total: thisMonthRental.toFixed(2),
      this_month_line_count: lineKpi.this_month_line_count || 0,
      this_month_laptop_count: lineKpi.this_month_laptop_count || 0,
      this_month_invoice_count: lineKpi.this_month_invoice_count || 0,
      catchup_total: catchupTotal.toFixed(2),
      catchup_line_count: lineKpi.catchup_line_count || 0,
      catchup_laptop_count: lineKpi.catchup_laptop_count || 0,
      catchup_invoice_count: lineKpi.catchup_invoice_count || 0,
      catchup_customer_count: lineKpi.catchup_customer_count || 0,
      catchup_details: catchupDetails,
      security_total: securityTotal.toFixed(2),
      security_invoice_count: securityDetails.length,
      security_customer_count: securityCustomers.size,
      security_laptop_count: securityDetails.reduce((sum, row) => sum + Number(row.laptop_count || 0), 0),
      security_details: securityDetails,
      billed_subtotal: (thisMonthRental + catchupTotal + securityTotal).toFixed(2),
      credit_note_pending_total: pendingCnRes.rows[0]?.pending_total || 0,
      credit_note_pending_count: pendingCnRes.rows[0]?.pending_count || 0,
    };

    const total = countRes.rows[0]?.n || 0;
    res.json({
      success: true,
      invoices: listRes.rows,
      summary,
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const MONTH_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Excel of billed rental serials for the current invoice filters. */
exports.exportInvoiceSerialsExcel = async (req, res) => {
  try {
    const list = invoiceListFilters(req.query, { includeStatus: true });
    if (!req.query.status) {
      list.where.push(`ci.status <> 'cancelled'`);
    }

    const { rows } = await pool.query(
      `SELECT
         COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), 'Customer #' || ci.customer_id) AS customer_name,
         ci.invoice_number,
         ci.invoice_month,
         ci.invoice_year,
         ci.status AS invoice_status,
         COALESCE(
           NULLIF(elem->>'brand', ''),
           NULLIF(vsn.extra->>'brand', ''),
           NULLIF(inv.brand, '')
         ) AS brand,
         COALESCE(
           NULLIF(elem->>'model', ''),
           NULLIF(vsn.extra->>'model', ''),
           NULLIF(vsn.extra->>'model_name', ''),
           NULLIF(inv.model, '')
         ) AS model,
         COALESCE(
           NULLIF(elem->>'processor', ''),
           NULLIF(vsn.extra->>'processor', ''),
           NULLIF(inv.processor, '')
         ) AS processor,
         COALESCE(
           NULLIF(elem->>'generation', ''),
           NULLIF(vsn.extra->>'generation', ''),
           NULLIF(inv.generation, '')
         ) AS generation,
         COALESCE(
           NULLIF(elem->>'ram', ''),
           NULLIF(vsn.extra->>'ram', ''),
           NULLIF(inv.ram, '')
         ) AS ram,
         COALESCE(
           NULLIF(elem->>'storage', ''),
           NULLIF(vsn.extra->>'storage', ''),
           NULLIF(inv.storage, '')
         ) AS storage,
         COALESCE(
           NULLIF(elem->>'ttspl_id', ''),
           NULLIF(vsn.inventory_asset_code, ''),
           NULLIF(vsn.extra->>'ttspl_id', '')
         ) AS ttspl,
         COALESCE(
           NULLIF(elem->>'serial_number', ''),
           NULLIF(vsn.serial_number, '')
         ) AS serial_number,
         LEFT(elem->>'rent_start', 10) AS rent_start,
         LEFT(elem->>'rent_end', 10) AS rent_end,
         NULLIF(elem->>'monthly_rate', '') AS monthly_rate,
         NULLIF(elem->>'amount', '') AS amount,
         CASE
           WHEN LOWER(COALESCE(elem->>'is_catchup', 'false')) IN ('true', 't', '1', 'yes')
           THEN 'Yes' ELSE 'No'
         END AS catchup
       FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(ci.line_items) = 'array' THEN ci.line_items ELSE '[]'::jsonb END
       ) elem
       LEFT JOIN LATERAL (
         SELECT v.serial_id, v.serial_number, v.inventory_asset_code, v.extra
           FROM vendor_serial_numbers v
          WHERE v.deleted_at IS NULL
            AND (
              (NULLIF(elem->>'serial_id', '') ~ '^[0-9]+$' AND v.serial_id = (elem->>'serial_id')::int)
              OR (
                NULLIF(elem->>'ttspl_id', '') IS NOT NULL
                AND v.inventory_asset_code = elem->>'ttspl_id'
              )
            )
          ORDER BY CASE
            WHEN NULLIF(elem->>'serial_id', '') ~ '^[0-9]+$'
             AND v.serial_id = (elem->>'serial_id')::int THEN 0
            ELSE 1
          END, v.serial_id
          LIMIT 1
       ) vsn ON TRUE
       LEFT JOIN LATERAL (
         SELECT i.brand, i.model, i.processor, i.generation, i.ram, i.storage
           FROM inventory i
          WHERE vsn.serial_id IS NOT NULL
            AND (
              i.serial_number = vsn.serial_number
              OR (
                vsn.inventory_asset_code IS NOT NULL
                AND i.machine_number = vsn.inventory_asset_code
              )
            )
          ORDER BY CASE WHEN i.serial_number = vsn.serial_number THEN 0 ELSE 1 END, i.inventory_id
          LIMIT 1
       ) inv ON TRUE
      WHERE ${list.where.join(' AND ')}
        AND COALESCE(elem->>'line_type', 'rental') <> 'security'
        AND COALESCE(elem->>'is_security', 'false') <> 'true'
      ORDER BY customer_name, ci.invoice_year, ci.invoice_month, ci.invoice_number,
               ttspl, rent_start`,
      list.params
    );

    const orderedRows = rows.map((r) => ({
      'Customer Name': r.customer_name || '',
      'Invoice Number': r.invoice_number || '',
      'Billing Month': `${MONTH_LABELS[Number(r.invoice_month)] || ''} ${r.invoice_year || ''}`.trim(),
      Status: r.invoice_status || '',
      Brand: r.brand || '',
      Model: r.model || '',
      Processor: r.processor || '',
      Generation: r.generation || '',
      RAM: r.ram || '',
      'Hard Disk': r.storage || '',
      TTSPL: r.ttspl || '',
      'Serial Number': r.serial_number || '',
      'Rent Start': r.rent_start || '',
      'Rent End': r.rent_end || '',
      'Monthly Rate': r.monthly_rate != null && r.monthly_rate !== '' ? Number(r.monthly_rate) : '',
      Amount: r.amount != null && r.amount !== '' ? Number(r.amount) : '',
      'Catch-up': r.catchup || 'No',
    }));

    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(orderedRows);
    ws['!cols'] = [
      { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
      { wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 12 },
      { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
      { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Billed Serials');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const month = Number(req.query.month);
    const year = Number(req.query.year);
    const stamp = month && year
      ? `${MONTH_LABELS[month] || month}_${year}`
      : new Date().toISOString().slice(0, 10);
    const filename = `invoice_billing_serials_${stamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('exportInvoiceSerialsExcel:', err);
    res.status(500).json({ success: false, message: err.message || 'Export failed' });
  }
};

function monthEndYmd(year, month) {
  const d = new Date(year, month, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Customers with rental assets vs invoices generated for a billing month. */
exports.listInvoiceCoverage = async (req, res) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!month || month < 1 || month > 12 || !year || year < 2000) {
      return res.status(400).json({ success: false, message: 'month and year required' });
    }

    const result = await pool.query(
      `WITH assets AS (
         SELECT vsn.current_customer_id AS customer_id,
                COUNT(*)::int AS asset_count,
                COUNT(*) FILTER (WHERE vsn.inventory_status = 'rented')::int AS rented_count,
                COUNT(*) FILTER (WHERE vsn.inventory_status = 'returned')::int AS returned_count
           FROM vendor_serial_numbers vsn
          WHERE vsn.current_customer_id IS NOT NULL
            AND vsn.deleted_at IS NULL
            AND vsn.inventory_status IN ('rented', 'returned')
            AND vsn.rent_start_date IS NOT NULL
            AND vsn.rent_start_date <= $1::date
          GROUP BY vsn.current_customer_id
       ),
       inv AS (
         SELECT DISTINCT ON (ci.customer_id)
                ci.customer_id, ci.invoice_id, ci.invoice_number, ci.status, ci.grand_total
           FROM customer_invoices ci
          WHERE ci.invoice_month = $2
            AND ci.invoice_year = $3
            AND ci.status <> 'cancelled'
          ORDER BY ci.customer_id, ci.invoice_id DESC
       )
       SELECT a.customer_id,
              COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), 'Customer #' || a.customer_id) AS customer_name,
              c.email,
              a.asset_count,
              a.rented_count,
              a.returned_count,
              i.invoice_id,
              i.invoice_number,
              i.status AS invoice_status,
              i.grand_total
         FROM assets a
         JOIN customers c ON c.customer_id = a.customer_id
         LEFT JOIN inv i ON i.customer_id = a.customer_id
        ORDER BY 2 ASC`,
      [monthEndYmd(year, month), month, year]
    );

    const customers = result.rows.map((row) => ({
      ...row,
      bucket: row.invoice_id ? 'invoiced' : 'pending',
    }));
    const invoiced = customers.filter((c) => c.bucket === 'invoiced');
    const pending = customers.filter((c) => c.bucket === 'pending');

    res.json({
      success: true,
      month,
      year,
      counts: {
        with_assets: customers.length,
        invoiced: invoiced.length,
        pending: pending.length,
        laptops: customers.reduce((n, c) => n + Number(c.asset_count || 0), 0),
      },
      customers,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const result = await pool.query(
      `SELECT ci.*, c.company_name AS customer_name, c.email AS customer_email,
              c.gst_no AS gst_number, c.address AS billing_address
       FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
       WHERE ci.invoice_id = $1`,
      [invoiceId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const creditNotes = await pool.query(
      `SELECT credit_note_number, amount, status
       FROM customer_credit_notes
       WHERE applied_in_invoice_id = $1 OR invoice_id = $1`,
      [invoiceId]
    );
    const invoice = result.rows[0];
    invoice.line_items = await enrichLineItemsWithSpecs(parseLineItems(invoice));
    const [zohoCandidates, zohoAcks] = await Promise.all([
      listZohoCandidates(pool, {
        customerId: invoice.customer_id,
        invoiceId: invoice.invoice_id,
        invoiceMonth: invoice.invoice_month,
        invoiceYear: invoice.invoice_year,
      }),
      pool.query(
        `SELECT serial_id, rent_billed_through::text, security_billed,
                external_invoice_ref, invoice_id
           FROM customer_serial_billing_ack
          WHERE customer_id = $1
          ORDER BY serial_id`,
        [invoice.customer_id]
      ),
    ]);
    res.json({
      success: true,
      invoice,
      credit_notes: creditNotes.rows,
      zoho_candidates: zohoCandidates,
      zoho_acks: zohoAcks.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markInvoiceGeneratedOnZoho = async (req, res) => {
  try {
    const invoiceId = Number(req.params.id);
    const body = req.body || {};
    const serialIds = Array.isArray(body.serial_ids) ? body.serial_ids : [];
    const result = await markInvoiceGeneratedOnZoho({
      invoiceId,
      serialIds,
      rentBilledThrough: body.rent_billed_through,
      includeSecurity: body.include_security !== false,
      externalReference: body.external_reference,
      actorUserId: req.user?.user_id || req.user?.id || null,
    });
    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }

    const inv = await pool.query(
      `SELECT customer_id FROM customer_invoices WHERE invoice_id = $1`,
      [invoiceId]
    );
    const customerId = inv.rows[0]?.customer_id;
    const laterDrafts = customerId
      ? (await pool.query(
        `SELECT invoice_month, invoice_year
           FROM customer_invoices
          WHERE customer_id = $1
            AND invoice_id <> $2
            AND LOWER(COALESCE(status, '')) = 'draft'
          ORDER BY invoice_year, invoice_month`,
        [customerId, invoiceId]
      )).rows
      : [];
    const reconciled = [];
    for (const draft of laterDrafts) {
      const gen = await generateCustomerInvoice(customerId, draft.invoice_month, draft.invoice_year);
      reconciled.push({
        invoice_month: draft.invoice_month,
        invoice_year: draft.invoice_year,
        ...gen,
      });
    }

    res.json({ success: true, ...result, reconciled });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.generateInvoice = async (req, res) => {
  try {
    const { customer_id, month, year } = req.body || {};
    if (!customer_id || !month || !year) {
      return res.status(400).json({ success: false, message: 'customer_id, month, year required' });
    }
    const result = await generateCustomerInvoice(Number(customer_id), Number(month), Number(year));
    if (result.skipped && !result.invoice_id) {
      return res.status(200).json({ success: true, skipped: true, reason: result.reason });
    }
    const inv = await pool.query(
      `SELECT ci.*, c.company_name AS customer_name FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
       WHERE ci.invoice_id = $1`,
      [result.invoice_id]
    );
    res.json({ success: true, ...result, invoice: inv.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.generateInvoicesBulk = async (req, res) => {
  try {
    const { customer_ids, all, month, year } = req.body || {};
    const m = Number(month);
    const y = Number(year);
    if (!m || !y) {
      return res.status(400).json({ success: false, message: 'month and year required' });
    }

    let results;
    if (all) {
      results = await generateAllCustomerInvoices(m, y);
    } else {
      const ids = Array.isArray(customer_ids)
        ? [...new Set(customer_ids.map((id) => Number(id)).filter((id) => id > 0))]
        : [];
      if (!ids.length) {
        return res.status(400).json({
          success: false,
          message: 'Select at least one customer, or enable “All billable customers”',
        });
      }
      results = [];
      for (const customerId of ids) {
        try {
          const result = await generateCustomerInvoice(customerId, m, y);
          results.push({ customer_id: customerId, ...result });
        } catch (err) {
          results.push({ customer_id: customerId, error: err.message });
        }
      }
    }

    const created = results.filter((r) => r.invoice_id && !r.skipped && !r.appended).length;
    const appended = results.filter((r) => r.appended).length;
    const skipped = results.filter((r) => r.skipped && !r.error).length;
    const errors = results.filter((r) => r.error).length;
    const creditNotesCreated = results.reduce((n, r) => n + Number(r.credit_notes_created || 0), 0);
    const creditNotesApplied = results.reduce((n, r) => n + Number(r.credit_notes_applied || 0), 0);

    res.json({
      success: true,
      summary: {
        total: results.length,
        created,
        appended,
        skipped,
        errors,
        credit_notes_created: creditNotesCreated,
        credit_notes_applied: creditNotesApplied,
      },
      results,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.sendInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { to_email, cc_emails } = req.body || {};
    const result = await pool.query(
      `SELECT ci.*,
              c.company_name AS customer_name,
              c.name AS customer_contact_name,
              c.email AS customer_email,
              c.phone AS customer_phone,
              c.gst_no AS gst_number,
              c.billing_address,
              c.billing_city,
              c.billing_state,
              c.billing_pincode,
              COALESCE(c.billing_type, 'prepaid') AS billing_type
       FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
       WHERE ci.invoice_id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const invoice = result.rows[0];
    const pdfPath = await generateCustomerInvoicePdf(invoice);
    await pool.query('UPDATE customer_invoices SET pdf_path = $1 WHERE invoice_id = $2', [pdfPath, id]);
    const to = to_email || invoice.customer_email;
    const cc = Array.isArray(cc_emails) ? cc_emails.join(',') : cc_emails;
    const sent = await emailDocument({
      to,
      cc,
      subject: `Invoice ${invoice.invoice_number} — Rentfoxxy`,
      text: `Please find attached invoice ${invoice.invoice_number} for the billing period ${invoice.from_date} to ${invoice.to_date}.`,
      pdfRelativePath: pdfPath,
    });
    await pool.query(
      `UPDATE customer_invoices
       SET status = 'sent', sent_at = NOW(), sent_by = $1, updated_at = NOW()
       WHERE invoice_id = $2`,
      [req.user?.user_id || null, id]
    );
    res.json({ success: true, email_sent: sent, message: sent ? 'Invoice sent' : 'Invoice marked sent (SMTP not configured)' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_reference, method } = req.body || {};
    const result = await recordFullPayment(pool, {
      partyType: 'customer',
      invoiceId: Number(id),
      reference: payment_reference || null,
      method: method || 'adjustment',
      recordedBy: req.user?.user_id || null,
    });
    if (result.skipped) {
      const inv = await pool.query(`SELECT * FROM customer_invoices WHERE invoice_id = $1`, [id]);
      if (!inv.rows.length) {
        return res.status(404).json({ success: false, message: 'Invoice not found' });
      }
      return res.json({ success: true, invoice: inv.rows[0], message: result.reason });
    }
    const inv = await pool.query(`SELECT * FROM customer_invoices WHERE invoice_id = $1`, [id]);
    res.json({ success: true, invoice: inv.rows[0], payment: result.payment });
  } catch (err) {
    res.status(err.message === 'Invoice not found' ? 404 : 500).json({ success: false, message: err.message });
  }
};

exports.recordInvoicePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, payment_date, method, reference, notes } = req.body || {};
    if (!amount) {
      return res.status(400).json({ success: false, message: 'amount is required' });
    }
    const result = await recordPayment(pool, {
      partyType: 'customer',
      invoiceId: Number(id),
      amount,
      paymentDate: payment_date,
      method,
      reference,
      notes,
      recordedBy: req.user?.user_id || null,
    });
    const inv = await pool.query(`SELECT * FROM customer_invoices WHERE invoice_id = $1`, [id]);
    res.status(201).json({
      success: true,
      payment: result.payment,
      amount_paid: result.amount_paid,
      status: result.status,
      invoice: inv.rows[0],
    });
  } catch (err) {
    const code = err.message === 'Invoice not found' ? 404 : 500;
    res.status(code).json({ success: false, message: err.message });
  }
};

exports.listInvoicePayments = async (req, res) => {
  try {
    const { invoiceId, id } = req.params;
    const targetId = invoiceId || id;
    const payments = await listPayments({ invoiceId: Number(targetId) });
    const inv = await pool.query(
      `SELECT invoice_id, grand_total, amount_paid, status FROM customer_invoices WHERE invoice_id = $1`,
      [targetId]
    );
    if (!inv.rows.length) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    res.json({ success: true, payments, invoice: inv.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.downloadInvoicePdf = async (req, res) => {
  try {
    // Route param is :invoiceId (older code read :id, which was always undefined
    // and made every PDF download 404). Accept either for safety.
    const id = req.params.invoiceId || req.params.id;
    const result = await pool.query(
      `SELECT ci.*,
              c.company_name AS customer_name,
              c.name AS customer_contact_name,
              c.email AS customer_email,
              c.phone AS customer_phone,
              c.gst_no AS gst_number,
              c.billing_address,
              c.billing_city,
              c.billing_state,
              c.billing_pincode,
              COALESCE(c.billing_type, 'prepaid') AS billing_type
       FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
       WHERE ci.invoice_id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const invoice = result.rows[0];
    const format = normalizeInvoiceFormat(req.query.format);
    // Always regenerate tax invoice PDF so branding/logo updates apply; laptop details is on-demand only.
    const pdfPath = await generateCustomerInvoicePdf(invoice, { format });
    if (format === 'tax_invoice') {
      await pool.query('UPDATE customer_invoices SET pdf_path = $1 WHERE invoice_id = $2', [pdfPath, id]);
    }
    res.download(
      path.join(__dirname, '..', pdfPath),
      invoicePdfDownloadName(invoice.invoice_number, format),
    );
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

exports.downloadInvoicesZip = async (req, res) => {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) {
    return res.status(400).json({ success: false, message: 'month and year are required' });
  }
  const format = normalizeInvoiceFormat(req.query.format || 'laptop_details');
  const createdFiles = [];
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const file of createdFiles) fs.unlink(file, () => {});
  };
  try {
    req.setTimeout(15 * 60 * 1000);
    res.setTimeout(15 * 60 * 1000);
    const result = await pool.query(
      `SELECT ci.*,
              c.company_name AS customer_name,
              c.name AS customer_contact_name,
              c.email AS customer_email,
              c.phone AS customer_phone,
              c.gst_no AS gst_number,
              c.billing_address,
              c.billing_city,
              c.billing_state,
              c.billing_pincode,
              COALESCE(c.billing_type, 'prepaid') AS billing_type
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.customer_id = ci.customer_id
        WHERE ci.invoice_month = $1
          AND ci.invoice_year = $2
          AND ci.status <> 'cancelled'
        ORDER BY COALESCE(c.company_name, c.name, ci.invoice_number)`,
      [month, year]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'No invoices found for that month' });
    }

    const generated = await mapPool(result.rows, 3, async (invoice) => {
      const pdfPath = await generateCustomerInvoicePdf(invoice, { format });
      const abs = path.join(__dirname, '..', pdfPath);
      createdFiles.push(abs);
      return { invoice, abs };
    });

    const monthLabel = MONTH_NAMES[month] || String(month);
    const zipName = `Laptop-Rental-Documents-${monthLabel}-${year}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
      else res.end();
    });
    archive.pipe(res);
    res.on('finish', cleanup);
    res.on('close', cleanup);

    const usedNames = new Set();
    for (const item of generated) {
      archive.file(item.abs, {
        name: uniqueCustomerPdfName(
          item.invoice.customer_name || item.invoice.customer_contact_name,
          item.invoice.invoice_number,
          usedNames,
        ),
      });
    }
    await archive.finalize();
  } catch (err) {
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    } else {
      res.end();
    }
  }
};

function creditNoteListFilters(query, { includeStatus = true } = {}) {
  const { customer_id, status, search, ttspl } = query;
  const params = [];
  const where = ['1=1'];
  if (customer_id) {
    params.push(customer_id);
    where.push(`cn.customer_id = $${params.length}`);
  }
  if (includeStatus && status) {
    params.push(status);
    where.push(`cn.status = $${params.length}`);
  }
  const ttsplKeys = (Array.isArray(ttspl) ? ttspl : String(ttspl || '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (ttsplKeys.length) {
    params.push(ttsplKeys);
    where.push(`EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(COALESCE(cn.ttspl_ids, '[]'::jsonb)) = 'array'
               THEN COALESCE(cn.ttspl_ids, '[]'::jsonb)
               ELSE '[]'::jsonb
          END
        ) AS t(code)
       WHERE t.code = ANY($${params.length}::text[])
    )`);
  }
  const qSearch = String(search || '').trim();
  if (qSearch) {
    params.push(`%${qSearch}%`);
    const n = params.length;
    where.push(`(
      cn.credit_note_number ILIKE $${n}
      OR COALESCE(c.company_name, '') ILIKE $${n}
      OR COALESCE(c.name, '') ILIKE $${n}
      OR COALESCE(cn.reason, '') ILIKE $${n}
      OR COALESCE(cn.description, '') ILIKE $${n}
      OR COALESCE(ci.invoice_number, '') ILIKE $${n}
      OR COALESCE(cn.ttspl_ids::text, '') ILIKE $${n}
    )`);
  }
  return { params, where };
}

const CREDIT_NOTE_FROM = `
  FROM customer_credit_notes cn
  LEFT JOIN customers c ON c.customer_id = cn.customer_id
  LEFT JOIN customer_invoices ci ON ci.invoice_id = COALESCE(cn.applied_in_invoice_id, cn.invoice_id)
  LEFT JOIN support_tickets st ON st.id = COALESCE(cn.support_ticket_id, cn.return_ticket_id)
`;

exports.listCreditNotes = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const list = creditNoteListFilters(req.query, { includeStatus: true });
    const kpi = creditNoteListFilters(req.query, { includeStatus: false });
    const laptopQuery = { ...req.query };
    delete laptopQuery.ttspl;
    const laptopScope = creditNoteListFilters(laptopQuery, { includeStatus: true });
    list.params.push(limit, offset);

    const [listRes, countRes, summaryRes, laptopRes] = await Promise.all([
      pool.query(
        `SELECT cn.*,
                c.company_name AS customer_name,
                ci.invoice_number,
                COALESCE(cn.return_dc_number, st.return_dc_number) AS return_dc_number,
                COALESCE(cn.support_ticket_id, st.id) AS support_ticket_id
         ${CREDIT_NOTE_FROM}
         WHERE ${list.where.join(' AND ')}
         ORDER BY cn.created_at DESC
         LIMIT $${list.params.length - 1} OFFSET $${list.params.length}`,
        list.params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n ${CREDIT_NOTE_FROM} WHERE ${list.where.join(' AND ')}`,
        list.params.slice(0, list.params.length - 2)
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_count,
           COALESCE(SUM(cn.amount), 0) AS total_amount,
           COUNT(*) FILTER (WHERE cn.status = 'pending')::int AS pending_count,
           COALESCE(SUM(cn.amount) FILTER (WHERE cn.status = 'pending'), 0) AS pending_amount,
           COUNT(*) FILTER (WHERE cn.status = 'approved')::int AS approved_count,
           COALESCE(SUM(cn.amount) FILTER (WHERE cn.status = 'approved'), 0) AS approved_amount,
           COUNT(*) FILTER (WHERE cn.status = 'applied')::int AS applied_count,
           COALESCE(SUM(cn.amount) FILTER (WHERE cn.status = 'applied'), 0) AS applied_amount,
           COUNT(*) FILTER (WHERE cn.status = 'cancelled')::int AS cancelled_count,
           COALESCE(SUM(cn.amount) FILTER (WHERE cn.status = 'cancelled'), 0) AS cancelled_amount
         ${CREDIT_NOTE_FROM}
         WHERE ${kpi.where.join(' AND ')}`,
        kpi.params
      ),
      pool.query(
        `SELECT DISTINCT t.code AS ttspl
         ${CREDIT_NOTE_FROM}
         CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(COALESCE(cn.ttspl_ids, '[]'::jsonb)) = 'array'
                THEN COALESCE(cn.ttspl_ids, '[]'::jsonb)
                ELSE '[]'::jsonb
           END
         ) AS t(code)
         WHERE ${laptopScope.where.join(' AND ')}
           AND t.code IS NOT NULL
           AND t.code <> ''
         ORDER BY 1
         LIMIT 500`,
        laptopScope.params
      ),
    ]);

    const total = countRes.rows[0]?.n || 0;
    res.json({
      success: true,
      credit_notes: listRes.rows,
      summary: summaryRes.rows[0] || {},
      laptops: laptopRes.rows.map((r) => r.ttspl),
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createCreditNote = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.customer_id || !body.reason) {
      return res.status(400).json({ success: false, message: 'customer_id and reason required' });
    }
    const cnNumber = await nextCreditNoteNumber();
    const amount = parseFloat(body.amount || 0);
    const result = await pool.query(
      `INSERT INTO customer_credit_notes
        (credit_note_number, customer_id, invoice_id, reason, description, amount,
         quantity, unit_rate, from_date, to_date, ttspl_ids, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
       RETURNING *`,
      [
        cnNumber,
        body.customer_id,
        body.invoice_id || null,
        body.reason,
        body.description || null,
        amount,
        body.quantity || 0,
        body.unit_rate || 0,
        body.from_date || null,
        body.to_date || null,
        JSON.stringify(body.ttspl_ids || []),
        req.user?.user_id || null,
      ]
    );
    res.status(201).json({ success: true, credit_note: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.approveCreditNote = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await approveAndApplyCreditNote(Number(id), req.user?.user_id || null);
    if (!result.ok) {
      return res.status(404).json({ success: false, message: result.reason });
    }
    res.json({
      success: true,
      credit_note: result.credit_note,
      applied: result.applied,
      invoice_id: result.invoice_id,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.approveCreditNotesBulk = async (req, res) => {
  try {
    const ids = [...new Set(
      (Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map((id) => Number(id))
        .filter((id) => id > 0)
    )];
    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'Select at least one credit note' });
    }
    const results = [];
    for (const id of ids) {
      try {
        const result = await approveAndApplyCreditNote(id, req.user?.user_id || null);
        results.push({ credit_note_id: id, ...result });
      } catch (err) {
        results.push({ credit_note_id: id, ok: false, reason: err.message });
      }
    }
    const approved = results.filter((r) => r.ok).length;
    const applied = results.filter((r) => r.applied).length;
    const failed = results.filter((r) => !r.ok).length;
    res.json({
      success: failed === 0,
      summary: { total: results.length, approved, applied, failed },
      results,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listSecurityDeposits = async (req, res) => {
  try {
    const { customer_id, status } = req.query;
    const params = [];
    const where = ['1=1'];
    if (customer_id) {
      params.push(customer_id);
      where.push(`sd.customer_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`sd.status = $${params.length}`);
    }
    const result = await pool.query(
      `SELECT sd.*, c.company_name AS customer_name
       FROM customer_security_deposits sd
       LEFT JOIN customers c ON c.customer_id = sd.customer_id
       WHERE ${where.join(' AND ')}
       ORDER BY sd.received_date DESC`,
      params
    );
    res.json({ success: true, deposits: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.recordSecurityDeposit = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.customer_id || !body.amount || !body.received_date) {
      return res.status(400).json({ success: false, message: 'customer_id, amount, received_date required' });
    }
    const result = await pool.query(
      `INSERT INTO customer_security_deposits
        (customer_id, sales_order_number, amount, received_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        body.customer_id,
        body.sales_order_number || null,
        body.amount,
        body.received_date,
        body.notes || null,
        req.user?.user_id || null,
      ]
    );
    res.status(201).json({ success: true, deposit: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.refundSecurityDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { refund_amount, refund_reference } = req.body || {};
    const existing = await pool.query('SELECT * FROM customer_security_deposits WHERE deposit_id = $1', [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Deposit not found' });
    }
    const dep = existing.rows[0];
    const refund = parseFloat(refund_amount || dep.amount);
    const totalRefunded = parseFloat(dep.refund_amount || 0) + refund;
    const newStatus = totalRefunded >= parseFloat(dep.amount) ? 'refunded' : 'partially_refunded';
    const result = await pool.query(
      `UPDATE customer_security_deposits
       SET refund_amount = $1, refund_date = CURRENT_DATE, refund_reference = $2,
           status = $3, updated_at = NOW()
       WHERE deposit_id = $4
       RETURNING *`,
      [totalRefunded, refund_reference || null, newStatus, id]
    );
    res.json({ success: true, deposit: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
