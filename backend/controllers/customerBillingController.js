const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { emailDocument } = require('../services/salesManagementPdfService');
const { generateCustomerInvoicePdf, invoicePdfDownloadName } = require('../services/customerInvoicePdfService');
const { normalizeInvoiceFormat, parseLineItems, enrichLineItemsWithSpecs } = require('../services/customerInvoiceHtmlService');
const {
  generateCustomerInvoice,
  generateAllCustomerInvoices,
  approveAndApplyCreditNote,
} = require('../services/billingSchedulerService');
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
    list.params.push(limit, offset);

    const [listRes, countRes, summaryRes] = await Promise.all([
      pool.query(
        `SELECT ci.*, c.company_name AS customer_name, c.email AS customer_email,
                COALESCE(jsonb_array_length(ci.line_items), 0) AS laptop_count
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
         WHERE ${kpi.where.join(' AND ')}`,
        kpi.params
      ),
    ]);

    const total = countRes.rows[0]?.n || 0;
    res.json({
      success: true,
      invoices: listRes.rows,
      summary: summaryRes.rows[0] || {},
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
    res.json({ success: true, invoice, credit_notes: creditNotes.rows });
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
              c.billing_pincode
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
              c.billing_pincode
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
