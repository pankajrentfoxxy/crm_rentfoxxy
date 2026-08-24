/**
 * Sales-pipeline quotation email (sales@rentfoxxy.com) + public Accept.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { generateToken } = require('./salesManagementService');
const { generateDocumentPdf } = require('./salesManagementPdfService');
const {
  getTransporter,
  getDefaultQuotationCc,
  parseCcList,
  buildQuotationEmailHtml,
  buildQuotationEmailText,
  formatSentAtLine,
  buildAcceptUrl,
  isConfigTwoActive,
  sendQuotationAcceptedEmail,
} = require('./leadQuotationService');

const QUOTE_SEND_LEAD_STATUSES = ['cold', 'warm', 'hot', 'deal', 'repeat', 'hold'];

function uniqueEmails(list) {
  const seen = new Set();
  const out = [];
  for (const e of list || []) {
    const n = String(e || '').trim().toLowerCase();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(String(e).trim());
  }
  return out;
}

function isSaleQuotation(quotationType) {
  const qt = String(quotationType || '').toLowerCase();
  return qt === 'sale' || qt === 'sales';
}

function configsFromQuotationLines(lines = []) {
  const unique = [];
  const seen = new Set();
  for (const line of lines) {
    const procCore = [line.processor, line.generation].filter(Boolean).join(' - ');
    const processor = [line.brand, procCore].filter(Boolean).join(' — ') || '—';
    const ram = line.ram || '—';
    const storage = line.storage || '—';
    const monthlyRate = Number(line.rate) || 0;
    const key = `${processor}|${ram}|${storage}|${monthlyRate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ processor, ram, storage, monthlyRate });
  }
  return {
    config1: unique[0] || { processor: '—', ram: '—', storage: '—', monthlyRate: 0 },
    config2: unique[1] || null,
  };
}

function quotationContactFields(head = {}) {
  const contactName = String(head.contact_name || head.customer_name || '').trim();
  const companyName = String(head.company_name || head.customer_name || '').trim();
  const phone = String(head.customer_mobile || '').trim();
  return { contactName, companyName, phone };
}

function assertQuotationSendFields(head) {
  const { contactName, companyName, phone } = quotationContactFields(head);
  if (!contactName) return 'Customer name is required';
  if (!companyName) return 'Company name is required';
  if (!phone) return 'Phone is required';
  return null;
}

async function assertLeadAllowsQuotationSend(sourceLeadId) {
  if (!sourceLeadId) return null;
  const r = await pool.query(
    `SELECT status FROM leads WHERE lead_id = $1 LIMIT 1`,
    [sourceLeadId]
  );
  if (!r.rows[0]) return 'Linked lead was not found';
  const status = String(r.rows[0].status || '').trim();
  if (!QUOTE_SEND_LEAD_STATUSES.includes(status.toLowerCase())) {
    return `Quotations can be sent for Cold, Warm, Hot, Deal, Repeat, or Hold leads. This lead is ${status || 'unknown'}.`;
  }
  return null;
}

async function resolveSender(user) {
  let senderName = user?.name || user?.username || 'Team';
  let senderEmail = user?.email || '';
  let senderPhone = user?.mobile_no || user?.phone || '';
  if (user?.user_id) {
    const u = await pool.query(
      `SELECT name, email, mobile_no FROM users WHERE user_id = $1 LIMIT 1`,
      [user.user_id]
    );
    if (u.rows[0]) {
      senderName = u.rows[0].name || senderName;
      senderEmail = u.rows[0].email || senderEmail;
      senderPhone = u.rows[0].mobile_no || senderPhone;
    }
  }
  return { senderName, senderEmail, senderPhone };
}

async function sendSalesQuotationEmail({
  quotationNumber,
  lines,
  toEmail,
  cc,
  user,
}) {
  const fieldError = assertQuotationSendFields(lines[0] || {});
  if (fieldError) throw new Error(fieldError);

  const leadError = await assertLeadAllowsQuotationSend(lines[0]?.source_lead_id);
  if (leadError) throw new Error(leadError);

  const to = String(toEmail || lines[0]?.customer_email || '').trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error('A valid customer email is required to send the quotation');
  }

  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('Email is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)');
  }

  let token = String(lines[0]?.token || '').trim();
  if (!token) {
    token = generateToken();
    await pool.query(
      `UPDATE sales_quotations SET token = $1, updated_at = NOW() WHERE quotation_number = $2`,
      [token, quotationNumber]
    );
  }

  let pdfPath = lines[0]?.pdf_path;
  if (!pdfPath) {
    pdfPath = await generateDocumentPdf({
      docType: 'quotation',
      docNumber: quotationNumber,
      header: lines[0],
      lines,
    });
    await pool.query(
      `UPDATE sales_quotations SET pdf_path = $1 WHERE quotation_number = $2`,
      [pdfPath, quotationNumber]
    );
  }

  const { senderName, senderEmail, senderPhone } = await resolveSender(user);
  const { companyName } = quotationContactFields(lines[0]);
  const isSale = isSaleQuotation(lines[0]?.quotation_type);
  const { config1, config2 } = configsFromQuotationLines(lines);
  const sentAtLine = formatSentAtLine(new Date());
  const acceptUrl = buildAcceptUrl(token);
  const fromAddress = process.env.QUOTATION_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER;
  const ccList = uniqueEmails([
    ...getDefaultQuotationCc(),
    senderEmail,
    ...parseCcList(cc),
  ]);

  const html = buildQuotationEmailHtml({
    senderName,
    senderPhone,
    estimateNo: quotationNumber,
    sentAtLine,
    config1,
    config2,
    acceptUrl,
    isSale,
    priceLabel: isSale ? 'Unit Price' : 'Monthly Unit Rental Price',
  });
  const text = buildQuotationEmailText({
    senderName,
    senderPhone,
    estimateNo: quotationNumber,
    sentAtLine,
    config1,
    config2,
    acceptUrl,
  });

  const abs = pdfPath ? path.join(__dirname, '..', pdfPath) : null;
  const attachments = abs && fs.existsSync(abs)
    ? [{ filename: path.basename(abs), path: abs }]
    : [];

  await transporter.sendMail({
    from: fromAddress,
    to,
    cc: ccList.length ? ccList.join(', ') : undefined,
    replyTo: senderEmail || fromAddress,
    subject: `Rentfoxxy ${isSale ? 'Sale' : 'Rental'} Laptop Quotation - ${companyName}`,
    text,
    html,
    attachments,
  });

  const updaterName = user?.name || user?.username || user?.email || 'Admin';
  await pool.query(
    `UPDATE sales_quotations SET
        status = CASE WHEN status IN ('accepted', 'approved', 'rejected') THEN status ELSE 'sent' END,
        customer_email = COALESCE(NULLIF(TRIM(customer_email), ''), $1),
        quotation_sent_at = NOW(),
        status_updated_by_id = $2,
        status_updated_by_name = $3,
        updated_at = NOW()
      WHERE quotation_number = $4`,
    [to, user?.user_id || null, updaterName, quotationNumber]
  );

  if (lines[0]?.source_lead_id) {
    await pool.query(
      `UPDATE leads
          SET quotation_accept_token = $1,
              quotation_last_sent_at = NOW(),
              quotation_last_estimate_no = $2,
              quotation_last_to_email = $3
        WHERE lead_id = $4`,
      [token, quotationNumber, to, lines[0].source_lead_id]
    ).catch(() => {});
  }

  return { sent: true, to, from: fromAddress, acceptUrl };
}

async function findSalesQuotationByToken(token) {
  if (!token) return null;
  const r = await pool.query(
    `SELECT quotation_number, customer_name, company_name, contact_name, customer_email,
            status, accepted_at, quotation_sent_at, source_lead_id, token
       FROM sales_quotations
      WHERE token = $1
      ORDER BY id ASC
      LIMIT 1`,
    [token]
  );
  return r.rows[0] || null;
}

async function previewSalesQuotationByToken(token) {
  const row = await findSalesQuotationByToken(token);
  if (!row) return null;
  return {
    success: true,
    company_name: row.company_name || row.customer_name || row.contact_name || 'Customer',
    estimate_no: row.quotation_number,
    accepted_at: row.accepted_at,
    sent_at: row.quotation_sent_at,
    source: 'sales_quotation',
  };
}

async function acceptSalesQuotationByToken(token) {
  const row = await findSalesQuotationByToken(token);
  if (!row) return null;

  const companyName = row.company_name || row.customer_name || row.contact_name || 'Customer';
  if (row.accepted_at || row.status === 'accepted') {
    return {
      success: true,
      already_accepted: true,
      message: 'This quotation was already accepted.',
      estimate_no: row.quotation_number,
      company_name: companyName,
      accepted_at: row.accepted_at,
      source: 'sales_quotation',
    };
  }

  const acceptRes = await pool.query(
    `UPDATE sales_quotations
        SET status = 'accepted',
            accepted_at = NOW(),
            updated_at = NOW()
      WHERE quotation_number = $1
        AND token = $2
        AND accepted_at IS NULL
      RETURNING accepted_at`,
    [row.quotation_number, token]
  );
  const acceptedAt = acceptRes.rows[0]?.accepted_at || new Date();

  if (row.source_lead_id) {
    await pool.query(
      `UPDATE leads SET quotation_accepted_at = COALESCE(quotation_accepted_at, NOW())
        WHERE lead_id = $1`,
      [row.source_lead_id]
    ).catch(() => {});
  }

  const toEmail = String(row.customer_email || '').trim().toLowerCase();
  if (toEmail) {
    try {
      await sendQuotationAcceptedEmail({
        toEmail,
        companyName,
        estimateNo: row.quotation_number,
        senderEmail: '',
        senderName: 'Team Rentfoxxy',
      });
    } catch (mailErr) {
      console.error('Quotation accepted email failed:', mailErr.message);
    }
  }

  return {
    success: true,
    message: 'Thank you — your acceptance has been recorded.',
    estimate_no: row.quotation_number,
    company_name: companyName,
    accepted_at: acceptedAt,
    source: 'sales_quotation',
  };
}

module.exports = {
  QUOTE_SEND_LEAD_STATUSES,
  isConfigTwoActive,
  configsFromQuotationLines,
  quotationContactFields,
  assertQuotationSendFields,
  assertLeadAllowsQuotationSend,
  sendSalesQuotationEmail,
  findSalesQuotationByToken,
  previewSalesQuotationByToken,
  acceptSalesQuotationByToken,
};
