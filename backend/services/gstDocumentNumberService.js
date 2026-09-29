/**
 * GST document numbers attached by Accounts (decision MD7, 29 Sep 2026).
 *
 * Three numbers come from outside the CRM and are typed in by Accounts:
 *   - the Zoho / e-invoice number on a customer delivery challan,
 *   - the e-way bill number on a delivery challan,
 *   - the Zoho invoice number on a sale-in-place sales order.
 *
 * Rules enforced here, used by every handler that writes them:
 *   1. A number already on the document is never silently overwritten. A
 *      different number is refused (409 REPLACE_REQUIRED) unless the caller sends
 *      `replace=1` and a `replace_reason`; the change is then audited in
 *      gst_document_number_changes (migration 375).
 *   2. Duplicates are refused. An e-way bill number belongs to one document
 *      (customer DC, vendor repair DC, vendor return DC, scrap challan). An
 *      invoice number may sit on several documents of the SAME customer — one
 *      Zoho invoice for several challans is real (QA: GRFB/2026-27/109 covers
 *      three DCs of one order) — but only when the caller confirms it with
 *      `share_invoice=1`; another customer's number is always refused.
 *   3. The check and the write happen under an advisory lock on the number, in
 *      the caller's transaction, so two uploads of the same number cannot both
 *      pass the duplicate check.
 */

const REPLACE_REASON_MIN = 5;

class GstNumberError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function cleanNumber(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return s || null;
}

function sameNumber(a, b) {
  return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
}

function isTruthyFlag(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
}

function replaceRequest(body = {}) {
  return {
    replace: isTruthyFlag(body.replace),
    reason: String(body.replace_reason ?? '').trim(),
    shareInvoice: isTruthyFlag(body.share_invoice),
  };
}

function firstNonEmpty(values = []) {
  for (const v of values) {
    const c = cleanNumber(v);
    if (c) return c;
  }
  return null;
}

/**
 * Rule 1. `current` is what the document holds, `next` what the caller sent
 * (null = "keep what is there"). Throws when the change is not allowed; returns
 * 'none' | 'attach' | 'replace'.
 */
function checkOverwrite({ label, docNumber, current, next, request }) {
  const cur = cleanNumber(current);
  const nxt = cleanNumber(next);
  if (!nxt || sameNumber(cur, nxt)) return 'none';
  if (!cur) return 'attach';
  if (!request?.replace) {
    throw new GstNumberError(
      409,
      'REPLACE_REQUIRED',
      `${docNumber} already has ${label} ${cur}. To change it, choose Replace and give a reason `
        + '(Finance → GST & e-way → Invoice & e-way queue).',
      { field_label: label, current: cur, requested: nxt },
    );
  }
  if ((request.reason || '').length < REPLACE_REASON_MIN) {
    throw new GstNumberError(
      400,
      'REASON_REQUIRED',
      `Give a reason (at least ${REPLACE_REASON_MIN} characters) for replacing ${label} ${cur} on ${docNumber}.`,
    );
  }
  return 'replace';
}

/** Serialise every writer of the same number for the rest of the transaction. */
async function lockNumber(db, number) {
  const n = cleanNumber(number);
  if (!n) return;
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gst-doc-no:${n.toUpperCase()}`]);
}

/** Where an invoice number is already used (DC e-invoice or sale-in-place SO invoice). */
async function findInvoiceNumberUses(db, number, { exceptDc = null, exceptSo = null } = {}) {
  const n = cleanNumber(number);
  if (!n) return [];
  const { rows } = await db.query(
    `SELECT 'delivery_challan' AS doc_type, dc_number AS doc_number,
            MIN(customer_id) AS customer_id, MIN(customer_name) AS customer_name
       FROM delivery_challan_lines
      WHERE einvoice_number IS NOT NULL
        AND UPPER(TRIM(einvoice_number)) = UPPER($1)
        AND dc_number IS DISTINCT FROM $2
        AND LOWER(COALESCE(status, '')) <> 'cancelled'
      GROUP BY dc_number
     UNION ALL
     SELECT 'sales_order', sales_order_number,
            MIN(customer_id), MIN(customer_name)
       FROM sales_order_lines
      WHERE sale_invoice_number IS NOT NULL
        AND UPPER(TRIM(sale_invoice_number)) = UPPER($1)
        AND sales_order_number IS DISTINCT FROM $3
        AND LOWER(COALESCE(status, '')) <> 'cancelled'
      GROUP BY sales_order_number`,
    [n, exceptDc, exceptSo]
  );
  return rows;
}

/** Where an e-way bill number is already used, across every document that carries one. */
async function findEwayNumberUses(db, number, { exceptType = null, exceptNumber = null } = {}) {
  const n = cleanNumber(number);
  if (!n) return [];
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT 'delivery_challan' AS doc_type, dc_number AS doc_number
         FROM delivery_challan_lines
        WHERE eway_bill_number IS NOT NULL
          AND UPPER(TRIM(eway_bill_number)) = UPPER($1)
          AND LOWER(COALESCE(status, '')) <> 'cancelled'
       UNION ALL
       SELECT 'vendor_repair_dc', dc_number FROM vendor_repair_delivery_challans
        WHERE UPPER(TRIM(COALESCE(eway_bill_number, ''))) = UPPER($1)
          AND LOWER(COALESCE(status, '')) <> 'cancelled'
       UNION ALL
       SELECT 'vendor_return_dc', dc_number FROM vendor_return_delivery_challans
        WHERE UPPER(TRIM(COALESCE(eway_bill_number, ''))) = UPPER($1)
          AND LOWER(COALESCE(status, '')) <> 'cancelled'
       UNION ALL
       SELECT 'scrap_challan', challan_number FROM scrap_challans
        WHERE UPPER(TRIM(COALESCE(eway_bill_number, ''))) = UPPER($1)
          AND LOWER(COALESCE(status, '')) <> 'cancelled'
     ) u
     WHERE NOT (u.doc_type = $2 AND u.doc_number = $3)`,
    [n, exceptType || '', exceptNumber || '']
  );
  return rows;
}

/** Rule 2 for e-way bills: one number, one document. */
async function assertEwayNumberFree(db, number, { docType, docNumber }) {
  const uses = await findEwayNumberUses(db, number, { exceptType: docType, exceptNumber: docNumber });
  if (uses.length) {
    throw new GstNumberError(
      409,
      'DUPLICATE_NUMBER',
      `E-way bill ${cleanNumber(number)} is already on ${uses.map((u) => u.doc_number).join(', ')}. `
        + 'An e-way bill number belongs to one document — check the number.',
      { uses },
    );
  }
}

/**
 * Rule 2 for invoice numbers: refused on another customer's document; allowed on
 * the same customer's documents only when the caller confirms a shared invoice.
 */
async function assertInvoiceNumberFree(db, number, { customerId, exceptDc = null, exceptSo = null, request }) {
  const uses = await findInvoiceNumberUses(db, number, { exceptDc, exceptSo });
  if (!uses.length) return;
  const n = cleanNumber(number);
  const others = uses.filter((u) => customerId == null || u.customer_id == null
    || Number(u.customer_id) !== Number(customerId));
  if (others.length) {
    throw new GstNumberError(
      409,
      'DUPLICATE_NUMBER',
      `Invoice ${n} is already on ${others.map((u) => `${u.doc_number}${u.customer_name ? ` (${u.customer_name})` : ''}`).join(', ')} `
        + '— another customer. Check the number.',
      { uses },
    );
  }
  if (!request?.shareInvoice) {
    throw new GstNumberError(
      409,
      'SHARED_INVOICE_CONFIRM',
      `Invoice ${n} is already on ${uses.map((u) => u.doc_number).join(', ')} for the same customer. `
        + 'If one invoice covers these documents, confirm it as a shared invoice.',
      { uses },
    );
  }
}

async function recordNumberChange(db, {
  docType, docNumber, field, action, oldValue, newValue, reason = null, userId = null,
}) {
  if (action !== 'attach' && action !== 'replace') return;
  await db.query(
    `INSERT INTO gst_document_number_changes
       (doc_type, doc_number, field, action, old_value, new_value, reason, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [docType, docNumber, field, action, cleanNumber(oldValue), cleanNumber(newValue),
      action === 'replace' ? reason : null, userId]
  );
}

/** Express helper: turn a GstNumberError into its response; returns false for anything else. */
function sendGstNumberError(res, err) {
  if (!(err instanceof GstNumberError)) return false;
  res.status(err.status).json({ success: false, code: err.code, message: err.message, ...err.extra });
  return true;
}

module.exports = {
  REPLACE_REASON_MIN,
  GstNumberError,
  cleanNumber,
  sameNumber,
  firstNonEmpty,
  replaceRequest,
  checkOverwrite,
  lockNumber,
  findInvoiceNumberUses,
  findEwayNumberUses,
  assertEwayNumberFree,
  assertInvoiceNumberFree,
  recordNumberChange,
  sendGstNumberError,
};
