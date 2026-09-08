'use strict';

const path = require('path');
const pool = require('../config/db');
const { enrichLineItemsWithSpecs } = require('./customerInvoiceHtmlService');
const {
  generateCustomerInvoicePdf,
  invoicePdfDownloadName,
} = require('./customerInvoicePdfService');

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function ymdParts(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString().slice(0, 10);
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  const raw = String(value || '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function dateKey(value) {
  const parts = ymdParts(value);
  if (parts) {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }
  return String(value || '').slice(0, 10);
}

function creditNoteBillingDate(cn) {
  return cn?.to_date || cn?.from_date || cn?.created_at || null;
}

function earlierDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) <= new Date(b) ? a : b;
}

function laterDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

function lineSortKey(line) {
  const start = dateKey(line?.rent_start || line?.from_date);
  const code = String(line?.ttspl_id || '').trim();
  return `${start}|${code}`;
}

function creditNoteLines(cn) {
  const stored = parseJsonArray(cn.line_items);
  if (stored.length) return stored;
  const ttspls = parseJsonArray(cn.ttspl_ids);
  if (!cn.serial_id && !ttspls.length && !Number(cn.amount)) return [];
  return [{
    serial_id: cn.serial_id || null,
    ttspl_id: ttspls[0] || null,
    amount: Number(cn.amount || 0),
    quantity: Number(cn.quantity || 0),
    unit_rate: Number(cn.unit_rate || 0),
    monthly_rate: Number(cn.unit_rate || 0)
      ? +(Number(cn.unit_rate) * 30).toFixed(2)
      : Number(cn.amount || 0),
    from_date: cn.from_date,
    to_date: cn.to_date,
    brand: 'Laptop rental',
    model: cn.reason || 'Credit note',
  }];
}

function toInvoiceLine(line, fallbackMonth, fallbackYear) {
  const fromParts = ymdParts(line.from_date || line.rent_start);
  const month = fromParts?.month || fallbackMonth;
  const year = fromParts?.year || fallbackYear;
  const monthDays = Number(line.month_days) || new Date(year, month, 0).getDate();
  const quantity = Number(line.quantity || line.days_in_month || 0) || 1;
  const unitRate = Number(line.unit_rate || 0);
  const amount = Number(line.amount || 0);
  return {
    ttspl_id: line.ttspl_id || null,
    serial_id: line.serial_id || null,
    brand: line.brand || 'Laptop rental',
    model: line.model || 'Unused prepaid days',
    amount,
    days_in_month: quantity,
    month_days: monthDays,
    monthly_rate: Number(line.monthly_rate || 0) || (unitRate > 0 ? +(unitRate * monthDays).toFixed(2) : amount),
    daily_rate: unitRate || (quantity > 0 ? +(amount / quantity).toFixed(2) : 0),
    rent_start: line.rent_start || line.from_date,
    rent_end: line.rent_end || line.to_date,
    serial_number: line.serial_number || null,
    processor: line.processor || '',
    generation: line.generation || '',
    ram: line.ram || '',
    storage: line.storage || '',
    period: `${year}-${String(month).padStart(2, '0')}`,
  };
}

function isGenericCreditNoteItem(line) {
  const brand = String(line?.brand || '').trim();
  const model = String(line?.model || '').trim();
  return !brand
    || !model
    || brand === 'Laptop rental'
    || model === 'Unused prepaid days'
    || model === 'Credit note';
}

async function hydrateCreditNoteLines(lines, customerId) {
  const withSpecs = await enrichLineItemsWithSpecs(lines);
  const ids = [...new Set(withSpecs.map((l) => Number(l.serial_id)).filter((n) => Number.isFinite(n) && n > 0))];
  const codes = [...new Set(withSpecs.map((l) => String(l.ttspl_id || '').trim()).filter(Boolean))];
  if (!ids.length && !codes.length) return withSpecs;

  const result = await pool.query(
    `SELECT DISTINCT ON (COALESCE(cil.serial_id, 0), COALESCE(cil.ttspl_id, ''))
            cil.serial_id,
            cil.ttspl_id,
            cil.brand,
            cil.model,
            cil.daily_rate,
            cil.monthly_rate
       FROM customer_invoice_lines cil
       JOIN customer_invoices ci ON ci.invoice_id = cil.invoice_id
      WHERE ci.customer_id = $1
        AND COALESCE(cil.line_type, 'rental') <> 'security'
        AND LOWER(COALESCE(ci.status, '')) <> 'cancelled'
        AND (
          (cardinality($2::int[]) > 0 AND cil.serial_id = ANY($2::int[]))
          OR (cardinality($3::text[]) > 0 AND cil.ttspl_id = ANY($3::text[]))
        )
      ORDER BY COALESCE(cil.serial_id, 0), COALESCE(cil.ttspl_id, ''), cil.rent_end DESC NULLS LAST`,
    [customerId, ids, codes]
  );

  const byId = new Map();
  const byCode = new Map();
  for (const row of result.rows) {
    if (row.serial_id) byId.set(Number(row.serial_id), row);
    if (row.ttspl_id) byCode.set(String(row.ttspl_id), row);
  }

  return withSpecs.map((line) => {
    const src = byId.get(Number(line.serial_id)) || byCode.get(String(line.ttspl_id || ''));
    if (!src) return line;
    const generic = isGenericCreditNoteItem(line);
    return {
      ...line,
      brand: generic ? (src.brand || line.brand) : line.brand,
      model: generic ? (src.model || line.model) : line.model,
      daily_rate: Number(line.daily_rate || line.unit_rate || src.daily_rate || 0),
      monthly_rate: Number(line.monthly_rate || src.monthly_rate || 0),
    };
  });
}

function creditNoteToInvoiceDocument(cn) {
  const fromParts = ymdParts(cn.from_date);
  const createdParts = ymdParts(cn.created_at);
  const month = fromParts?.month || createdParts?.month || (new Date().getMonth() + 1);
  const year = fromParts?.year || createdParts?.year || new Date().getFullYear();
  const rawLines = creditNoteLines(cn);
  const lineItems = rawLines.map((line) => toInvoiceLine(line, month, year));
  const amount = Number(cn.amount || 0) || lineItems.reduce((n, line) => n + Number(line.amount || 0), 0);

  return {
    document_kind: 'credit_note',
    invoice_number: cn.credit_note_number,
    invoice_date: cn.created_at,
    invoice_month: month,
    invoice_year: year,
    from_date: cn.from_date,
    to_date: cn.to_date,
    customer_id: cn.customer_id,
    customer_name: cn.customer_name,
    customer_contact_name: cn.customer_contact_name,
    customer_email: cn.customer_email,
    customer_phone: cn.customer_phone,
    gst_number: cn.gst_number || cn.gst_no,
    billing_address: cn.billing_address,
    billing_city: cn.billing_city,
    billing_state: cn.billing_state,
    billing_pincode: cn.billing_pincode,
    billing_type: cn.billing_type || 'prepaid',
    entity_code: cn.entity_code || 'rentfoxxy',
    subtotal: amount,
    gst_percent: 18,
    gst_amount: 0,
    credit_note_adjustment: 0,
    security_deposit: 0,
    grand_total: amount,
    line_items: lineItems.length ? lineItems : [{
      ttspl_id: null,
      brand: 'Laptop rental',
      model: cn.reason || 'Credit note',
      amount,
      days_in_month: Number(cn.quantity || 1),
      month_days: new Date(year, month, 0).getDate(),
      monthly_rate: amount,
      rent_start: cn.from_date,
      rent_end: cn.to_date,
      period: `${year}-${String(month).padStart(2, '0')}`,
    }],
  };
}

function creditNotePdfDownloadName(creditNoteNumber, format) {
  return invoicePdfDownloadName(creditNoteNumber, format);
}

async function hydrateCreditNoteDocument(cn) {
  const invoice = creditNoteToInvoiceDocument(cn);
  invoice.line_items = await hydrateCreditNoteLines(invoice.line_items, cn.customer_id);
  return invoice;
}

async function loadApprovedCreditNotesForCustomerMonth(cn) {
  const customerId = Number(cn?.customer_id);
  if (!Number.isFinite(customerId) || customerId <= 0) return [];
  const result = await pool.query(
    `SELECT *
       FROM customer_credit_notes
      WHERE customer_id = $1
        AND LOWER(COALESCE(status, '')) IN ('approved', 'applied')
        AND date_trunc('month', COALESCE(to_date, from_date, (created_at AT TIME ZONE 'Asia/Kolkata')::date))
          = date_trunc('month', COALESCE($2::date, $3::date, ($4::timestamptz AT TIME ZONE 'Asia/Kolkata')::date))
      ORDER BY COALESCE(from_date, to_date, (created_at AT TIME ZONE 'Asia/Kolkata')::date) ASC,
               credit_note_id ASC`,
    [customerId, cn.to_date || null, cn.from_date || null, cn.created_at || null]
  );
  return result.rows;
}

async function buildConsolidatedCreditNoteDocument(primaryCn, siblingRows = []) {
  const byId = new Map();
  for (const row of siblingRows) {
    if (row?.credit_note_id != null) byId.set(Number(row.credit_note_id), row);
  }
  if (primaryCn?.credit_note_id != null && !byId.has(Number(primaryCn.credit_note_id))) {
    byId.set(Number(primaryCn.credit_note_id), primaryCn);
  }
  const notes = [...byId.values()].sort((a, b) => {
    const aDate = dateKey(creditNoteBillingDate(a));
    const bDate = dateKey(creditNoteBillingDate(b));
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return Number(a.credit_note_id) - Number(b.credit_note_id);
  });

  const lineItems = [];
  let minFrom = primaryCn.from_date || null;
  let maxTo = primaryCn.to_date || null;
  for (const note of notes) {
    const fromParts = ymdParts(note.from_date) || ymdParts(note.to_date) || ymdParts(note.created_at);
    const month = fromParts?.month;
    const year = fromParts?.year;
    for (const line of creditNoteLines(note)) {
      lineItems.push(toInvoiceLine(line, month, year));
    }
    minFrom = earlierDate(minFrom, note.from_date || lineItems[lineItems.length - 1]?.rent_start);
    maxTo = laterDate(maxTo, note.to_date || lineItems[lineItems.length - 1]?.rent_end);
  }
  lineItems.sort((a, b) => lineSortKey(a).localeCompare(lineSortKey(b)));

  const invoice = creditNoteToInvoiceDocument(primaryCn);
  invoice.line_items = await hydrateCreditNoteLines(lineItems, primaryCn.customer_id);
  const total = invoice.line_items.reduce((n, line) => n + Number(line.amount || 0), 0);
  invoice.subtotal = total;
  invoice.grand_total = total;
  invoice.from_date = minFrom || invoice.from_date;
  invoice.to_date = maxTo || invoice.to_date;
  const period = ymdParts(invoice.to_date) || ymdParts(invoice.from_date);
  if (period) {
    invoice.invoice_month = period.month;
    invoice.invoice_year = period.year;
  }
  return invoice;
}

async function generateCustomerCreditNotePdf(creditNote, options = {}) {
  const status = String(creditNote?.status || '').toLowerCase();
  if (status !== 'approved' && status !== 'applied') {
    throw new Error('PDF is available only for approved credit notes');
  }
  const siblings = await loadApprovedCreditNotesForCustomerMonth(creditNote);
  const invoice = siblings.length > 1
    ? await buildConsolidatedCreditNoteDocument(creditNote, siblings)
    : await hydrateCreditNoteDocument(creditNote);
  return generateCustomerInvoicePdf(invoice, options);
}

module.exports = {
  creditNoteToInvoiceDocument,
  hydrateCreditNoteDocument,
  creditNotePdfDownloadName,
  generateCustomerCreditNotePdf,
  CREDIT_NOTE_PDF_DIR: path.join(__dirname, '../uploads/customer-invoices'),
};
