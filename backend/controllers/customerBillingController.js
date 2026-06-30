const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { emailDocument } = require('../services/salesManagementPdfService');
const {
  generateCustomerInvoice,
} = require('../services/billingSchedulerService');
const {
  recordPayment,
  recordFullPayment,
  listPayments,
} = require('../services/paymentLedgerService');

const UPLOAD_DIR = path.join(__dirname, '../uploads/customer-invoices');

async function nextCreditNoteNumber() {
  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1
     WHERE doc_type = 'credit_note'
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  return res.rows[0].number;
}

// Format 'YYYY-MM-DD' (or a Date) as e.g. "15 May 2026".
function fmtDate(d) {
  if (!d) return '—';
  let s;
  if (typeof d === 'string') {
    s = d.slice(0, 10);
  } else {
    // Use LOCAL components: a `date` column returns a JS Date at midnight;
    // toISOString() would shift it back a day in IST.
    const dt = new Date(d);
    s = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  const [y, m, day] = s.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!y || !m || !day) return s;
  return `${parseInt(day, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}
function fmtMoney(n) {
  return `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function generateInvoicePdf(invoice) {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fileName = `${invoice.invoice_number}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/customer-invoices/${fileName}`;
  const lineItems = typeof invoice.line_items === 'string'
    ? JSON.parse(invoice.line_items)
    : (invoice.line_items || []);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ── Header ────────────────────────────────────────────────
    doc.fontSize(18).font('Helvetica-Bold').text('Rentfoxxy', { continued: true })
       .font('Helvetica').fontSize(12).text('  Technologies Pvt Ltd');
    doc.fontSize(15).font('Helvetica-Bold').text('Customer Invoice (Prepaid Rental)', { align: 'right' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10);
    const topY = doc.y;
    doc.text(`Invoice No: ${invoice.invoice_number}`, 40, topY);
    doc.text(`Invoice Date: ${fmtDate(invoice.invoice_date)}`, 40);
    doc.text(`Billing Period: ${fmtDate(invoice.from_date)}  to  ${fmtDate(invoice.to_date)}`, 40);
    doc.text(`Customer: ${invoice.customer_name || invoice.customer_id}`, 320, topY);
    if (invoice.gst_number) doc.text(`GSTIN: ${invoice.gst_number}`, 320);
    doc.moveDown(1);

    // ── Line item table ───────────────────────────────────────
    const x = { idx: 40, asset: 64, item: 200, period: 330, days: 450, amount: 510 };
    const drawHead = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('#', x.idx, y);
      doc.text('TTSPL / Serial', x.asset, y);
      doc.text('Item', x.item, y);
      doc.text('Period', x.period, y);
      doc.text('Days', x.days, y, { width: 50, align: 'right' });
      doc.text('Amount', x.amount, y, { width: 55, align: 'right' });
      doc.moveTo(40, doc.y + 2).lineTo(565, doc.y + 2).stroke();
      doc.moveDown(0.5);
    };
    drawHead();
    doc.font('Helvetica').fontSize(9);

    lineItems.forEach((line, idx) => {
      if (doc.y > 740) { doc.addPage(); drawHead(); doc.font('Helvetica').fontSize(9); }
      const y = doc.y;
      doc.fillColor('#000').text(String(idx + 1), x.idx, y);
      // TTSPL id with Serial Number directly below it
      doc.font('Helvetica-Bold').text(line.ttspl_id || '—', x.asset, y, { width: 130 });
      doc.font('Helvetica').fillColor('#555').fontSize(8)
         .text(line.serial_number ? `SN: ${line.serial_number}` : '', x.asset, doc.y, { width: 130 });
      doc.fillColor('#000').fontSize(9);
      doc.text(`${line.brand || ''} ${line.model || ''}`.trim() || '—', x.item, y, { width: 125 });
      doc.text(`${fmtDate(line.rent_start)} - ${fmtDate(line.rent_end)}${line.is_catchup ? '  (catch-up)' : ''}${line.returned ? '  (returned)' : ''}`,
        x.period, y, { width: 118 });
      doc.text(`${line.days_in_month}${line.month_days ? `/${line.month_days}` : ''}`, x.days, y, { width: 50, align: 'right' });
      doc.text(fmtMoney(line.amount), x.amount, y, { width: 55, align: 'right' });
      doc.moveDown(0.8);
    });

    doc.moveTo(40, doc.y + 2).lineTo(565, doc.y + 2).stroke();
    doc.moveDown(0.6);

    // ── Totals ────────────────────────────────────────────────
    const totRow = (label, val, opts = {}) => {
      const y = doc.y;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 10);
      if (opts.color) doc.fillColor(opts.color);
      doc.text(label, 360, y, { width: 120, align: 'right' });
      doc.text(val, 485, y, { width: 80, align: 'right' });
      doc.fillColor('#000');
      doc.moveDown(0.4);
    };
    totRow('Subtotal', fmtMoney(invoice.subtotal));
    totRow(`GST (${invoice.gst_percent}%)`, fmtMoney(invoice.gst_amount));
    if (parseFloat(invoice.credit_note_adjustment) > 0) {
      totRow('Credit Notes', `- ${fmtMoney(invoice.credit_note_adjustment)}`, { color: '#b00' });
    }
    totRow('Grand Total', fmtMoney(invoice.grand_total), { bold: true });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return relativePath;
}

// Exposed for tests / scripts.
exports._generateInvoicePdf = generateInvoicePdf;

exports.ensureBillingEngineSchema = async () => {
  const sqlPath = path.join(__dirname, '../migrations/067_phase5_billing_engine.sql');
  if (!fs.existsSync(sqlPath)) return;
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
};

exports.listInvoices = async (req, res) => {
  try {
    const { customer_id, month, year, status, page = 1, limit = 50 } = req.query;
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
    if (status) {
      params.push(status);
      where.push(`ci.status = $${params.length}`);
    }
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    params.push(parseInt(limit, 10), offset);

    const [listRes, summaryRes] = await Promise.all([
      pool.query(
        `SELECT ci.*, c.company_name AS customer_name, c.email AS customer_email,
                COALESCE(jsonb_array_length(ci.line_items), 0) AS laptop_count
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.customer_id = ci.customer_id
         WHERE ${where.join(' AND ')}
         ORDER BY ci.invoice_year DESC, ci.invoice_month DESC, ci.invoice_id DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_count,
           COALESCE(SUM(grand_total) FILTER (WHERE status = 'draft'), 0) AS draft_total,
           COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
           COALESCE(SUM(grand_total) FILTER (WHERE status = 'sent'), 0) AS sent_total,
           COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
           COALESCE(SUM(grand_total) FILTER (WHERE status = 'paid'), 0) AS paid_total,
           COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue_count,
           COALESCE(SUM(grand_total) FILTER (WHERE status = 'overdue'), 0) AS overdue_total,
           COALESCE(SUM(grand_total) FILTER (WHERE status IN ('sent','overdue')), 0) AS outstanding_total
         FROM customer_invoices ci
         WHERE ${where.slice(0, where.length).join(' AND ').replace(/ci\./g, 'ci.')}`,
        params.slice(0, params.length - 2)
      ),
    ]);

    res.json({
      success: true,
      invoices: listRes.rows,
      summary: summaryRes.rows[0] || {},
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
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
    res.json({ success: true, invoice: result.rows[0], credit_notes: creditNotes.rows });
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

exports.sendInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { to_email, cc_emails } = req.body || {};
    const result = await pool.query(
      `SELECT ci.*, c.company_name AS customer_name, c.email AS customer_email
       FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
       WHERE ci.invoice_id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const invoice = result.rows[0];
    const pdfPath = invoice.pdf_path || await generateInvoicePdf(invoice);
    if (!invoice.pdf_path) {
      await pool.query('UPDATE customer_invoices SET pdf_path = $1 WHERE invoice_id = $2', [pdfPath, id]);
    }
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
    res.status(err.message === 'Invoice not found' ? 404 : (err.statusCode || 500)).json({ success: false, message: err.message });
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
    const code = err.message === 'Invoice not found' ? 404 : (err.statusCode || 500);
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
      `SELECT ci.*, c.company_name AS customer_name, c.gst_no AS gst_number
       FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
       WHERE ci.invoice_id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const invoice = result.rows[0];
    let pdfPath = invoice.pdf_path;
    if (!pdfPath) {
      pdfPath = await generateInvoicePdf(invoice);
      await pool.query('UPDATE customer_invoices SET pdf_path = $1 WHERE invoice_id = $2', [pdfPath, id]);
    }
    const abs = path.join(__dirname, '..', pdfPath);
    if (!fs.existsSync(abs)) {
      pdfPath = await generateInvoicePdf(invoice);
      await pool.query('UPDATE customer_invoices SET pdf_path = $1 WHERE invoice_id = $2', [pdfPath, id]);
    }
    res.download(path.join(__dirname, '..', pdfPath));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listCreditNotes = async (req, res) => {
  try {
    const { customer_id, status } = req.query;
    const params = [];
    const where = ['1=1'];
    if (customer_id) {
      params.push(customer_id);
      where.push(`cn.customer_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`cn.status = $${params.length}`);
    }
    const result = await pool.query(
      `SELECT cn.*, c.company_name AS customer_name, ci.invoice_number
       FROM customer_credit_notes cn
       LEFT JOIN customers c ON c.customer_id = cn.customer_id
       LEFT JOIN customer_invoices ci ON ci.invoice_id = cn.invoice_id
       WHERE ${where.join(' AND ')}
       ORDER BY cn.created_at DESC`,
      params
    );
    res.json({ success: true, credit_notes: result.rows });
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
    const result = await pool.query(
      `UPDATE customer_credit_notes
       SET status = 'approved', approved_by = $1, updated_at = NOW()
       WHERE credit_note_id = $2 AND status = 'pending'
       RETURNING *`,
      [req.user?.user_id || null, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Credit note not found or not pending' });
    }
    res.json({ success: true, credit_note: result.rows[0] });
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
