/**
 * Accounts' GST document queues — real amounts and the e-way bill register
 * (decision MD7, 29 Sep 2026).
 *
 * Queue amounts. The DC invoice queue used to show `dc_qty × average SO rate`
 * (or the stored e-way asset value) and the e-invoice queue summed rate × qty
 * over a join that repeated every order line once per challan line. Neither is
 * what the invoice will say. Each row now carries the billed amount from
 * resolveDcBilling() and the CGST+SGST / IGST split from computeGstBreakdown()
 * with the challan's place of supply — the same numbers the challan page and the
 * upload handler use. A row whose billing cannot be resolved keeps the old figure
 * and is flagged `amount_is_estimate`.
 *
 * E-way value. The e-way rule uses the laptops' asset value (processor +
 * generation matrix), not the billed rent — computeDcAssetValue(), exactly as the
 * upload handler decides "e-way required". The queue used to decide it from the
 * estimate, so it could say "not required" and then the upload demanded one.
 */
const pool = require('../config/db');
const {
  getDeliveryChallanLines,
  resolveDcBilling,
  computeGstBreakdown,
  resolveSupplyStateFromAddress,
} = require('./salesManagementService');
const {
  EWAY_VALUE_THRESHOLD,
  computeDcAssetValue,
  requiresEwayBill,
} = require('./saleDcComplianceService');

/** Run `fn` over `items` with at most `limit` in flight (the pool has 20 connections). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function invoiceFromTotals(totals, supplyState) {
  return {
    subtotal: totals.subtotal,
    gst_type: totals.gst_type,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    gst_total: totals.gst_total,
    shipping: totals.shipping,
    security: totals.security,
    grand_total: totals.grand_total,
    place_of_supply: supplyState || null,
    // computeGstBreakdown falls back to intra-state when the state is unknown;
    // say so rather than present a guessed split as fact.
    place_of_supply_known: Boolean(supplyState),
  };
}

/** Billed amount + GST split + e-way asset value for one challan. */
async function dcAmounts(dcNumber) {
  const lines = await getDeliveryChallanLines(dcNumber);
  if (!lines.length) return null;
  const head = lines[0];
  const { subtotal } = await resolveDcBilling(dcNumber, lines);
  const supplyState = resolveSupplyStateFromAddress(head.customer_shipping_address, head.supply_state);
  const totals = computeGstBreakdown({
    subtotal,
    shipping: head.shiping_charges,
    security: head.security_amount,
    supplyState,
  });
  const asset = await computeDcAssetValue(dcNumber, lines);
  return {
    invoice: invoiceFromTotals(totals, supplyState),
    eway_value: asset.total,
    eway_value_basis: asset.fallback_billed ? 'billed' : 'asset',
  };
}

/**
 * Adds `invoice`, `eway_value`, `requires_eway_bill` and `amount_is_estimate` to
 * each queue row (rows keyed by dc_number). Rows beyond `max` keep the estimate.
 */
async function enrichDcRows(rows, { max = 400, concurrency = 8 } = {}) {
  const head = rows.slice(0, max);
  await mapLimit(head, concurrency, async (row) => {
    try {
      const a = await dcAmounts(row.dc_number);
      if (!a) { row.amount_is_estimate = true; return; }
      row.invoice = a.invoice;
      row.eway_value = a.eway_value;
      row.eway_value_basis = a.eway_value_basis;
      row.requires_eway_bill = Boolean(row.eway_required) || requiresEwayBill(a.eway_value);
      row.amount_is_estimate = false;
    } catch (err) {
      console.error('[gstQueue] amounts for', row.dc_number, err.message);
      row.amount_is_estimate = true;
    }
  });
  for (const row of rows.slice(max)) row.amount_is_estimate = true;
  return rows;
}

/** Sale-in-place SO rows: order value + GST from the order's place of supply. */
function enrichSaleOrderRows(rows) {
  for (const row of rows) {
    const supplyState = resolveSupplyStateFromAddress(row.customer_shipping_address, row.supply_state);
    const totals = computeGstBreakdown({
      subtotal: row.order_value,
      shipping: row.shipping_charges,
      security: row.security_amount,
      supplyState,
    });
    row.invoice = invoiceFromTotals(totals, supplyState);
    row.amount_is_estimate = false;
    delete row.customer_shipping_address;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// E-way bill register — one read list across every document that carries an
// e-way bill number. Each document keeps its own number (there is no e-way
// table the CRM writes to: eway_bill_records is only filled by the Zoho GSP
// call and is empty), so this is a read-only UNION over the four document
// tables, filtered and sorted server-side.
// ---------------------------------------------------------------------------

const DOC_TYPES = ['dc', 'demo_dc', 'vrdc', 'vrtdc', 'scrap'];
const LEFT_STATUSES = new Set([
  'in_transit', 'shipped', 'reached', 'delivered', 'dispatched', 'completed',
  'partially_returned', 'returned', 'picked', 'partially_picked',
]);

const REGISTER_SQL = `
  WITH dc AS (
    SELECT DISTINCT ON (dcl.dc_number)
           CASE WHEN LOWER(COALESCE(sol.quotation_type, '')) = 'demo' THEN 'demo_dc' ELSE 'dc' END AS doc_type,
           dcl.dc_number                                   AS doc_number,
           dcl.sales_order_number                          AS ref_number,
           COALESCE(dcl.customer_name, sol.customer_name)  AS party,
           LOWER(COALESCE(dcl.status, ''))                 AS status,
           dcl.created_at,
           NULLIF(TRIM(dcl.eway_bill_number), '')          AS eway_bill_number,
           dcl.eway_bill_date,
           dcl.eway_bill_valid_till                        AS eway_valid_till,
           (dcl.eway_bill_pdf_path IS NOT NULL)            AS has_document,
           dcl.eway_asset_value::float                     AS stored_value,
           dcl.vehicle_number
      FROM delivery_challan_lines dcl
      LEFT JOIN LATERAL (
        SELECT quotation_type, customer_name FROM sales_order_lines
         WHERE sales_order_number = dcl.sales_order_number
         ORDER BY id LIMIT 1
      ) sol ON TRUE
     WHERE COALESCE(dcl.movement_type, 'outbound') = 'outbound'
       AND dcl.created_at >= $1::date AND dcl.created_at < ($2::date + 1)
     ORDER BY dcl.dc_number, dcl.id
  ),
  vrdc AS (
    SELECT 'vrdc'::text, d.dc_number, NULL::text, d.vendor_name, LOWER(COALESCE(d.status, '')), d.created_at,
           NULLIF(TRIM(d.eway_bill_number), ''), d.eway_bill_date, NULL::timestamptz,
           (d.eway_bill_pdf_path IS NOT NULL),
           (SELECT COALESCE(SUM(i.price), 0)::float FROM vendor_repair_dc_items i WHERE i.dc_number = d.dc_number),
           d.vehicle_number
      FROM vendor_repair_delivery_challans d
     WHERE d.created_at >= $1::date AND d.created_at < ($2::date + 1)
  ),
  vrtdc AS (
    SELECT 'vrtdc'::text, d.dc_number, d.return_ticket_number, d.vendor_name, LOWER(COALESCE(d.status, '')), d.created_at,
           NULLIF(TRIM(d.eway_bill_number), ''), d.eway_bill_date, NULL::timestamptz,
           (d.eway_bill_pdf_path IS NOT NULL),
           (SELECT COALESCE(SUM(i.declared_value), 0)::float FROM vendor_return_dc_items i
             WHERE i.dc_number = d.dc_number AND COALESCE(i.item_status, '') <> 'cancelled'),
           d.vehicle_number
      FROM vendor_return_delivery_challans d
     WHERE d.created_at >= $1::date AND d.created_at < ($2::date + 1)
  ),
  scrap AS (
    SELECT 'scrap'::text, s.challan_number, NULL::text, s.recipient_name, LOWER(COALESCE(s.status, '')), s.created_at,
           NULLIF(TRIM(s.eway_bill_number), ''), s.eway_bill_date, NULL::timestamptz,
           FALSE, s.sale_total::float, NULL::text
      FROM scrap_challans s
     WHERE s.created_at >= $1::date AND s.created_at < ($2::date + 1)
  )
  SELECT * FROM (
    SELECT * FROM dc
    UNION ALL SELECT * FROM vrdc
    UNION ALL SELECT * FROM vrtdc
    UNION ALL SELECT * FROM scrap
  ) u
  WHERE ($3::text IS NULL OR u.doc_type = $3)
    AND ($4::text IS NULL
         OR u.doc_number ILIKE $4 OR u.party ILIKE $4
         OR u.eway_bill_number ILIKE $4 OR u.ref_number ILIKE $4)
  ORDER BY u.created_at DESC NULLS LAST, u.doc_number DESC
  LIMIT 2000
`;

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function parseYmd(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function ewayState(row) {
  if (row.status === 'cancelled') return 'cancelled';
  if (row.eway_bill_number) return 'on_file';
  if (row.value == null) return 'unknown';
  return requiresEwayBill(row.value) ? 'needed' : 'not_needed';
}

/**
 * @param {object} q  { type, state: on_file|needed|not_needed|left_without, search, from, to, limit }
 */
async function listEwayRegister(q = {}, { db = pool } = {}) {
  const today = new Date();
  const to = parseYmd(q.to) || ymd(today);
  const from = parseYmd(q.from) || ymd(new Date(today.getTime() - 90 * 86400000));
  const type = DOC_TYPES.includes(q.type) ? q.type : null;
  const search = String(q.search || '').trim();
  const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 500);
  const state = ['on_file', 'needed', 'not_needed', 'left_without', 'unknown'].includes(q.state) ? q.state : null;

  const { rows } = await db.query(REGISTER_SQL, [from, to, type, search ? `%${search}%` : null]);

  for (const r of rows) {
    r.value = r.stored_value != null && Number(r.stored_value) > 0 ? Number(r.stored_value) : null;
    r.value_basis = r.value != null ? (r.doc_type === 'vrtdc' ? 'declared' : r.doc_type === 'scrap' ? 'sale' : 'asset') : null;
  }

  // A customer DC without a stored asset value is valued the way the e-way rule
  // values it. Only rows that could be flagged (no number, not cancelled) need it
  // before filtering; the rest are valued after the page is cut.
  const needsValue = (r) => (r.doc_type === 'dc' || r.doc_type === 'demo_dc') && r.value == null && r.status !== 'cancelled';
  const valueDc = async (r) => {
    try {
      const a = await computeDcAssetValue(r.doc_number);
      r.value = Number(a.total) > 0 ? Number(a.total) : null;
      r.value_basis = r.value != null ? (a.fallback_billed ? 'billed' : 'asset') : null;
    } catch (err) {
      console.error('[ewayRegister] value for', r.doc_number, err.message);
    }
  };

  // Every document that could be flagged is valued, so the counts cover the
  // whole period, not just the page.
  await mapLimit(rows.filter((r) => !r.eway_bill_number && needsValue(r)), 8, valueDc);
  const counts = { on_file: 0, needed: 0, not_needed: 0, unknown: 0, cancelled: 0, left_without: 0 };
  for (const r of rows) {
    r.eway_state = ewayState(r);
    r.left_premises = LEFT_STATUSES.has(r.status);
    r.left_without_eway = r.eway_state === 'needed' && r.left_premises;
    counts[r.eway_state] += 1;
    if (r.left_without_eway) counts.left_without += 1;
  }
  let candidates = rows;
  if (state === 'left_without') candidates = rows.filter((r) => r.left_without_eway);
  else if (state) candidates = rows.filter((r) => r.eway_state === state);

  const page = candidates.slice(0, limit);
  // Documents with a number on file are valued for display only.
  await mapLimit(page.filter(needsValue), 8, valueDc);
  for (const r of page) delete r.stored_value;

  return {
    from,
    to,
    threshold: EWAY_VALUE_THRESHOLD,
    total: candidates.length,
    counts,
    truncated: rows.length >= 2000,
    rows: page,
  };
}

module.exports = {
  mapLimit,
  dcAmounts,
  enrichDcRows,
  enrichSaleOrderRows,
  listEwayRegister,
  DOC_TYPES,
};
