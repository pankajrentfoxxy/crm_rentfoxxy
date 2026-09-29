/**
 * Vendor money (MD5, MD6) — vendor bills, debit notes and vendor payments.
 *
 *   GST        A vendor bill charged `subtotal * 0.18` with no split. The split
 *              now comes from computeGstBreakdown / isIntraState with the
 *              vendor's state (from its GSTIN, else its address) against the
 *              company's (Haryana), and is stored per bill.
 *   Debit notes  A note raised after the bill month used to be marked "adjusted"
 *              on that bill without being deducted. pickDebitNotes decides which
 *              approved notes a bill actually deducts; the rest stay approved
 *              and are deducted on a later bill.
 *              Drafts from vendor return / repair are raised at Rs 0; they can
 *              now have their amount set or be cancelled, and Rs 0 cannot be
 *              approved. Numbers are allocated inside the write transaction.
 *   Payments   payment_records already holds vendor payments (party_type
 *              'vendor'). A payment now locks the bill, is only taken on an
 *              approved bill, and cannot exceed what is still owed.
 */
const pool = require('../config/db');
const { computeGstBreakdown } = require('./salesManagementService');
const { recordPayment, sumPayments } = require('./paymentLedgerService');
const { BillingActionError } = require('./invoiceLifecycleService');
const { vendorBillEvent, BILLING_EVENTS } = require('./billingEventService');
const { recordEvent } = require('./eventService');
const { nextDebitNoteNumber } = require('./vendorDebitNoteService');

const DEBIT_NOTE = 'vendor_debit_note';
const DN_EVENTS = Object.freeze({
  CREATED: 'debit_note_created',
  AMOUNT_SET: 'debit_note_amount_set',
  APPROVED: 'debit_note_approved',
  CANCELLED: 'debit_note_cancelled',
});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A GSTIN is 2-digit state code + PAN + entity + Z + check. */
const GSTIN_RE = /^(\d{2})[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/**
 * Where the vendor supplies from. The GSTIN's state code is the legal
 * registration, so it wins; the address state is the fallback (vendors.state is
 * free text on older rows: "UP", "DL", "HR", "madhya_pradesh" …).
 * Pure — used by vendorSupplyState and by the tests.
 */
function supplyStateFromVendor(vendor) {
  const gstin = String(vendor?.gst_number || '').trim().toUpperCase();
  const m = gstin.match(GSTIN_RE);
  if (m) return { state: m[1], source: 'gstin' };
  const addr = String(vendor?.state || vendor?.shipping_state || '').trim();
  if (addr) return { state: addr, source: 'address' };
  return { state: null, source: null };
}

async function vendorSupplyState(db, vendorId) {
  const { rows } = await (db || pool).query(
    `SELECT gst_number, state, shipping_state FROM vendors WHERE vendor_id = $1`,
    [vendorId]
  );
  return supplyStateFromVendor(rows[0]);
}

/** The bill's GST, split, from the shared helper. */
function vendorBillGst(subtotal, supplyState) {
  const b = computeGstBreakdown({ subtotal: round2(subtotal), supplyState: supplyState || '' });
  return {
    gst_amount: b.gst_total,
    cgst_amount: b.cgst,
    sgst_amount: b.sgst,
    igst_amount: b.igst,
    is_intra_state: b.gst_type === 'intra',
    place_of_supply: supplyState || null,
  };
}

/**
 * Which approved debit notes this bill deducts. Oldest first; a note is taken
 * only whole, and only while the running deduction does not exceed what the
 * bill is worth — a note too large to fit stays approved for the next bill
 * instead of being swallowed by Math.max(0, …). Pure.
 * @param notes [{ debit_note_id, amount }] already bounded to the bill period
 * @returns { applied: notes[], total }
 */
function pickDebitNotes(notes, grossPayable) {
  const cap = round2(grossPayable);
  const applied = [];
  let total = 0;
  for (const n of notes || []) {
    const amt = round2(n.amount);
    if (!(amt > 0)) continue;
    if (round2(total + amt) > cap) continue;
    applied.push(n);
    total = round2(total + amt);
  }
  return { applied, total };
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

// ── Vendor payments ─────────────────────────────────────────────────────────

const PAYABLE_STATUSES = new Set(['approved', 'partially_paid']);
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIst() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Record a payment against a vendor bill. `full: true` pays whatever is still
 * owed (the old "Mark paid"). Runs in its own transaction with the bill row
 * locked, so two clicks cannot both see the same outstanding amount.
 */
async function recordVendorBillPayment({
  billId, amount, full = false, paymentDate = null, method = null, reference = null, notes = null,
  actor = null, correlationId = null,
}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT bill_id, bill_number, vendor_id, status, total_payable
         FROM vendor_monthly_bills WHERE bill_id = $1 FOR UPDATE`,
      [billId]
    );
    const bill = rows[0];
    if (!bill) throw new BillingActionError('Bill not found', 404);
    const status = String(bill.status || '').toLowerCase();
    if (status === 'paid') throw new BillingActionError('This bill is already paid in full', 409);
    if (!PAYABLE_STATUSES.has(status)) {
      throw new BillingActionError(
        `This bill is "${bill.status}" — only an approved bill can be paid`,
        409
      );
    }

    const paidSoFar = await sumPayments(client, { billId });
    const outstanding = round2(Number(bill.total_payable || 0) - paidSoFar);
    if (outstanding <= 0) throw new BillingActionError('Nothing is owed on this bill', 409);

    const amt = full ? outstanding : round2(amount);
    if (!(amt > 0)) throw new BillingActionError('Payment amount must be greater than zero');
    if (amt > outstanding) {
      throw new BillingActionError(
        `Rs ${amt.toFixed(2)} is more than the Rs ${outstanding.toFixed(2)} still owed on ${bill.bill_number}`
      );
    }

    let payDate = paymentDate ? String(paymentDate).slice(0, 10) : todayIst();
    if (!YMD_RE.test(payDate)) throw new BillingActionError('Payment date must be YYYY-MM-DD');
    if (payDate > todayIst()) throw new BillingActionError('Payment date cannot be in the future');

    // recordPayment opens its own transaction when handed something with
    // .connect (a pool — and a pg client has .connect too), so give it a bare
    // query function: it then runs on this client, inside this lock.
    const q = { query: (...a) => client.query(...a) };
    const result = await recordPayment(q, {
      partyType: 'vendor',
      billId,
      amount: amt,
      paymentDate: payDate,
      method: method ? String(method).trim().slice(0, 40) : (full ? 'adjustment' : null),
      reference: reference ? String(reference).trim().slice(0, 120) : null,
      notes: notes ? String(notes).trim().slice(0, 2000) : null,
      recordedBy: actor?.user_id || null,
    });

    await vendorBillEvent(client, {
      billId,
      billNumber: bill.bill_number,
      eventType: result.status === 'paid' ? BILLING_EVENTS.BILL_PAID : BILLING_EVENTS.BILL_PAYMENT_RECORDED,
      fromState: status,
      toState: result.status,
      payload: { amount: amt, reference: reference || null, method: method || null, payment_id: result.payment?.payment_id },
      actor,
      correlationId,
      source: 'vendorBillService.recordVendorBillPayment',
    });

    return result;
  });
}

/** Every vendor payment, newest first — the ledger had only per-bill reads. */
async function listVendorPayments(db, {
  vendorId = null, search = '', from = null, to = null, page = 1, limit = 50,
} = {}) {
  const params = [];
  const where = [`pr.party_type = 'vendor'`];
  if (vendorId) { params.push(Number(vendorId)); where.push(`pr.vendor_id = $${params.length}`); }
  if (from && YMD_RE.test(String(from))) { params.push(from); where.push(`pr.payment_date >= $${params.length}::date`); }
  if (to && YMD_RE.test(String(to))) { params.push(to); where.push(`pr.payment_date <= $${params.length}::date`); }
  const s = String(search || '').trim();
  if (s) {
    params.push(`%${s}%`);
    const n = params.length;
    where.push(`(vb.bill_number ILIKE $${n} OR COALESCE(pr.reference, '') ILIKE $${n}
                 OR COALESCE(v.business_name, v.first_name, '') ILIKE $${n})`);
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
  const whereSql = where.join(' AND ');
  const from_ = `FROM payment_records pr
      LEFT JOIN vendor_monthly_bills vb ON vb.bill_id = pr.bill_id
      LEFT JOIN vendors v ON v.vendor_id = pr.vendor_id
      LEFT JOIN users u ON u.user_id = pr.recorded_by
     WHERE ${whereSql}`;
  const client = db || pool;
  const [list, agg] = await Promise.all([
    client.query(
      `SELECT pr.payment_id, pr.bill_id, pr.vendor_id, pr.amount, pr.payment_date, pr.method,
              pr.reference, pr.notes, pr.created_at,
              vb.bill_number, vb.bill_month, vb.bill_year, vb.status AS bill_status,
              COALESCE(NULLIF(v.business_name, ''), v.first_name) AS vendor_name,
              u.name AS recorded_by_name
         ${from_}
        ORDER BY pr.payment_date DESC, pr.payment_id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (pageNum - 1) * size]
    ),
    client.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(pr.amount), 0) AS amount ${from_}`, params),
  ]);
  return {
    payments: list.rows,
    total: agg.rows[0]?.total || 0,
    total_amount: Number(agg.rows[0]?.amount || 0),
    page: pageNum,
    limit: size,
  };
}

// ── Debit notes ─────────────────────────────────────────────────────────────

function dnEvent(db, note, eventType, { fromState = null, toState = null, payload = {}, actor = null, source }) {
  return recordEvent(db, {
    entityType: DEBIT_NOTE,
    entityId: note.debit_note_id,
    entityRef: note.debit_note_number,
    eventType,
    fromState,
    toState,
    payload,
    actor,
    source,
  });
}

async function getDebitNote(db, id) {
  const { rows } = await (db || pool).query(
    `SELECT dn.*,
            COALESCE(NULLIF(v.business_name, ''), v.first_name) AS vendor_name,
            vpo.purchase_order_number AS po_number,
            vb.bill_number AS adjusted_in_bill_number, vb.status AS adjusted_in_bill_status,
            uc.name AS created_by_name, ua.name AS approved_by_name,
            ux.name AS cancelled_by_name, us.name AS amount_set_by_name
       FROM vendor_debit_notes dn
       LEFT JOIN vendors v ON v.vendor_id = dn.vendor_id
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = dn.po_id
       LEFT JOIN vendor_monthly_bills vb ON vb.bill_id = dn.adjusted_in_bill_id
       LEFT JOIN users uc ON uc.user_id = dn.created_by
       LEFT JOIN users ua ON ua.user_id = dn.approved_by
       LEFT JOIN users ux ON ux.user_id = dn.cancelled_by
       LEFT JOIN users us ON us.user_id = dn.amount_set_by
      WHERE dn.debit_note_id = $1`,
    [id]
  );
  return rows[0] || null;
}

function parseMoney(v, label) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new BillingActionError(`${label} must be a number, zero or more`);
  return round2(n);
}

/** amount wins; else quantity x unit_rate; else 0 (a draft). */
function resolveAmount({ amount, quantity, unit_rate: unitRate }) {
  const a = parseMoney(amount, 'Amount');
  const q = quantity === undefined || quantity === null || quantity === '' ? null : parseInt(quantity, 10);
  if (q !== null && (!Number.isInteger(q) || q < 0)) throw new BillingActionError('Units must be a whole number');
  const r = parseMoney(unitRate, 'Unit rate');
  if (a !== null) return { amount: a, quantity: q, unit_rate: r };
  if (q !== null && r !== null) return { amount: round2(q * r), quantity: q, unit_rate: r };
  return { amount: 0, quantity: q, unit_rate: r };
}

async function createDebitNote(body, actor) {
  const vendorId = parseInt(body?.vendor_id, 10);
  const reason = String(body?.reason || '').trim();
  if (!vendorId || !reason) throw new BillingActionError('vendor_id and reason required');
  const { amount, quantity, unit_rate: unitRate } = resolveAmount(body || {});
  const poId = body?.po_id ? parseInt(body.po_id, 10) : null;
  const ttspl = Array.isArray(body?.ttspl_ids) ? body.ttspl_ids.map((t) => String(t).trim()).filter(Boolean) : [];

  return withTransaction(async (client) => {
    const v = await client.query(`SELECT vendor_id FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [vendorId]);
    if (!v.rows.length) throw new BillingActionError('Vendor not found', 404);
    if (poId) {
      const po = await client.query(`SELECT vendor_id FROM vendor_purchase_orders WHERE po_id = $1`, [poId]);
      if (!po.rows.length) throw new BillingActionError('Purchase order not found', 404);
      if (Number(po.rows[0].vendor_id) !== vendorId) {
        throw new BillingActionError('That purchase order belongs to a different vendor');
      }
    }
    const number = await nextDebitNoteNumber(client);
    const ins = await client.query(
      `INSERT INTO vendor_debit_notes
         (debit_note_number, vendor_id, po_id, reason, description, amount,
          quantity, unit_rate, ttspl_ids, created_by, source,
          amount_set_by, amount_set_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'manual',
               CASE WHEN $6::numeric > 0 THEN $10::int END, CASE WHEN $6::numeric > 0 THEN NOW() END)
       RETURNING *`,
      [
        number, vendorId, poId, reason.slice(0, 255), body?.description ? String(body.description).slice(0, 4000) : null,
        amount, quantity ?? 0, unitRate ?? 0, JSON.stringify(ttspl), actor?.user_id || null,
      ]
    );
    const note = ins.rows[0];
    await dnEvent(client, note, DN_EVENTS.CREATED, {
      toState: 'pending', payload: { amount }, actor, source: 'vendorBillService.createDebitNote',
    });
    return note;
  });
}

async function lockDebitNote(client, id) {
  const { rows } = await client.query(
    `SELECT * FROM vendor_debit_notes WHERE debit_note_id = $1 FOR UPDATE`,
    [id]
  );
  if (!rows.length) throw new BillingActionError('Debit note not found', 404);
  return rows[0];
}

/** Set the amount (and optionally units, rate, description) on a pending note. */
async function setDebitNoteAmount(id, body, actor) {
  const { amount, quantity, unit_rate: unitRate } = resolveAmount(body || {});
  if (!(amount > 0)) throw new BillingActionError('Enter an amount greater than zero');
  return withTransaction(async (client) => {
    const note = await lockDebitNote(client, id);
    if (String(note.status || 'pending') !== 'pending') {
      throw new BillingActionError(`This debit note is ${note.status} — only a pending note can be changed`, 409);
    }
    const desc = body?.description !== undefined ? String(body.description || '').slice(0, 4000) : null;
    const { rows } = await client.query(
      `UPDATE vendor_debit_notes
          SET amount = $2,
              quantity = COALESCE($3, quantity),
              unit_rate = COALESCE($4, unit_rate),
              description = COALESCE($5, description),
              amount_set_by = $6, amount_set_at = NOW(), updated_at = NOW()
        WHERE debit_note_id = $1
        RETURNING *`,
      [id, amount, quantity, unitRate, desc, actor?.user_id || null]
    );
    await dnEvent(client, note, DN_EVENTS.AMOUNT_SET, {
      fromState: 'pending', toState: 'pending',
      payload: { from: Number(note.amount || 0), to: amount }, actor, source: 'vendorBillService.setDebitNoteAmount',
    });
    return rows[0];
  });
}

async function approveDebitNote(id, actor) {
  return withTransaction(async (client) => {
    const note = await lockDebitNote(client, id);
    if (String(note.status || 'pending') !== 'pending') {
      throw new BillingActionError(`This debit note is ${note.status} — only a pending note can be approved`, 409);
    }
    if (!(Number(note.amount) > 0)) {
      throw new BillingActionError('This debit note is Rs 0. Set the amount before approving it.', 409);
    }
    const { rows } = await client.query(
      `UPDATE vendor_debit_notes
          SET status = 'approved', approved_by = $2, updated_at = NOW()
        WHERE debit_note_id = $1 AND status = 'pending'
        RETURNING *`,
      [id, actor?.user_id || null]
    );
    await dnEvent(client, note, DN_EVENTS.APPROVED, {
      fromState: 'pending', toState: 'approved', payload: { amount: Number(note.amount) }, actor,
      source: 'vendorBillService.approveDebitNote',
    });
    return rows[0];
  });
}

/** Cancel a pending note, or an approved one no bill has deducted yet. */
async function cancelDebitNote(id, reason, actor) {
  const why = String(reason || '').trim();
  if (why.length < 5) throw new BillingActionError('A cancellation reason is required (at least 5 characters)');
  return withTransaction(async (client) => {
    const note = await lockDebitNote(client, id);
    const status = String(note.status || 'pending');
    if (status === 'cancelled') throw new BillingActionError('This debit note is already cancelled', 409);
    if (status === 'adjusted' || note.adjusted_in_bill_id) {
      throw new BillingActionError(
        'This debit note has been deducted on a vendor bill. Cancel that bill first, then this note.',
        409
      );
    }
    const { rows } = await client.query(
      `UPDATE vendor_debit_notes
          SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2,
              cancellation_reason = $3, updated_at = NOW()
        WHERE debit_note_id = $1
        RETURNING *`,
      [id, actor?.user_id || null, why.slice(0, 2000)]
    );
    await dnEvent(client, note, DN_EVENTS.CANCELLED, {
      fromState: status, toState: 'cancelled', payload: { reason: why }, actor,
      source: 'vendorBillService.cancelDebitNote',
    });
    return rows[0];
  });
}

module.exports = {
  DEBIT_NOTE,
  DN_EVENTS,
  round2,
  supplyStateFromVendor,
  vendorSupplyState,
  vendorBillGst,
  pickDebitNotes,
  withTransaction,
  recordVendorBillPayment,
  listVendorPayments,
  getDebitNote,
  createDebitNote,
  setDebitNoteAmount,
  approveDebitNote,
  cancelDebitNote,
  resolveAmount,
};
