/**
 * Loan laptop (temporary replacement) workflow.
 *
 * A rental customer's laptop goes for repair; support lends them a laptop from
 * stock until it comes back. No Sales Order is created or touched. The loan can
 * be raised and dispatched as soon as the repair pickup exists — collecting the
 * original (technician, courier, BlueDart, porter…) runs independently on that
 * pickup's Return DC; only repair completion and conversion wait for it.
 *
 *   requested ─▶ pending_approval ─▶ approved ─▶ dc_generated ─▶ dispatched ─▶ loan_active
 *        └──────(policy allows)──────▲                                         │
 *                                                       repair_completed ◀─────┘
 *                                                               │
 *                                                        decision_pending
 *                          ┌────────────────────────────────────┴───────────────────────┐
 *        return_in_progress ─▶ returned                conversion_pending_approval ─▶ converted
 *
 *   side exits: rejected (Accounts), cancelled (before the laptop leaves)
 *
 * Billing invariants (see inventoryStateMachine ON_LOAN and billingSchedulerService):
 *   - the loan laptop carries no rent anchor while on_loan, so nothing bills it;
 *   - the original keeps billing through the repair exactly as it does today;
 *   - only an Accounts-approved conversion moves billing: the original stops on
 *     effective_date - 1 and the loan laptop starts on effective_date at the
 *     approved rate, never earlier unless Accounts authorises a retroactive date.
 */
const inventorySM = require('./inventoryStateMachine');
const { nextFinancialYearNumber, entityForQuotationType, resolveCustomerDocumentName } = require('./salesManagementService');
const { resolveHsnForPersist } = require('../constants/hsnDefaults');
const { logTtsplEvent } = require('./ttsplAuditService');
const policyService = require('./loanReplacementPolicyService');
const { assertLoanSchema } = require('./loanSchema');

const DC_PURPOSE = 'loan';
const RETURN_DC_PURPOSE = 'loan_return';

const STATUS = Object.freeze({
  REQUESTED: 'requested',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  DC_GENERATED: 'dc_generated',
  DISPATCHED: 'dispatched',
  LOAN_ACTIVE: 'loan_active',
  REPAIR_COMPLETED: 'repair_completed',
  DECISION_PENDING: 'decision_pending',
  RETURN_IN_PROGRESS: 'return_in_progress',
  RETURNED: 'returned',
  CONVERSION_PENDING_APPROVAL: 'conversion_pending_approval',
  CONVERTED: 'converted',
  CANCELLED: 'cancelled',
});

const TERMINAL = new Set([STATUS.REJECTED, STATUS.CANCELLED, STATUS.RETURNED, STATUS.CONVERTED]);
const CANCELLABLE = new Set([STATUS.REQUESTED, STATUS.PENDING_APPROVAL, STATUS.APPROVED, STATUS.DC_GENERATED]);
const CONFIRMATION_METHODS = Object.freeze([
  'phone_call', 'email', 'whatsapp', 'written', 'in_person', 'customer_portal',
]);
// Repair pickup statuses that mean the customer's laptop has left them.
const PICKED_UP_ITEM_STATUSES = new Set([
  'picked_up', 'in_transit', 'awaiting_service_return', 'inventory_updated',
]);

class LoanError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

// ── small helpers ───────────────────────────────────────────────────────────

const actorOf = (user = {}) => ({
  user_id: user.user_id || user.id || null,
  name: user.name || user.email || null,
});

function istYmd(d = new Date()) {
  return new Date(d).toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function parseYmd(value, label) {
  const s = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new LoanError(`${label} must be a date (YYYY-MM-DD)`);
  }
  return s;
}

function parseRate(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new LoanError(`${label} must be a positive amount`);
  return Math.round(n * 100) / 100;
}

const parseJson = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

function specFromSerial(row) {
  const extra = row?.extra || {};
  const pa = row?.pa || {};
  return {
    brand: extra.brand || pa.brand || null,
    model: extra.model || extra.model_name || pa.model || null,
    processor: extra.processor || pa.processor || null,
    generation: extra.generation || pa.generation || null,
    ram: extra.ram || pa.ram || null,
    storage: extra.storage || pa.ssd || null,
    screen_size: extra.screen_size || pa.screen_size || null,
  };
}

async function loadSerial(db, serialId, { forUpdate = false } = {}) {
  const r = await db.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.inventory_status,
            vsn.qc_status, vsn.current_customer_id, vsn.current_dc_number, vsn.current_entity,
            vsn.rent_start_date, vsn.rent_end_date, vsn.rent_monthly_rate, vsn.rent_billed_until,
            vsn.delivered_at, vsn.dispatched_at, vsn.extra
       FROM vendor_serial_numbers vsn
      WHERE vsn.serial_id = $1 AND vsn.deleted_at IS NULL
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [serialId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const pa = await db.query(
    `SELECT brand, model, processor, generation, ram, ssd, screen_size
       FROM production_assets WHERE vendor_serial_id = $1 ORDER BY 1 LIMIT 1`,
    [serialId]
  ).catch(() => ({ rows: [] }));
  row.pa = pa.rows[0] || null;
  row.ttspl_id = row.inventory_asset_code || row.extra?.ttspl_id || null;
  row.spec = specFromSerial(row);
  return row;
}

async function logEvent(db, { requestId, from = null, to = null, action, detail = null, actor = {} }) {
  await db.query(
    `INSERT INTO support_loan_request_events
       (loan_request_id, from_status, to_status, action, detail, actor_user_id, actor_name)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [requestId, from, to, action, detail ? JSON.stringify(detail) : null, actor.user_id || null, actor.name || null]
  );
}

async function logTicketAudit(db, { ticketId, itemId = null, userId, action, detail }) {
  await db.query(
    `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [itemId, ticketId, userId || null, action, detail ? JSON.stringify(detail) : null]
  ).catch((e) => console.error('loanLaptop.ticketAudit', e.message));
}

async function lockRequest(db, id) {
  const r = await db.query(`SELECT * FROM support_loan_requests WHERE id = $1 FOR UPDATE`, [id]);
  if (!r.rows[0]) throw new LoanError('Loan request not found', 404);
  return r.rows[0];
}

/**
 * Move a locked request to `to`, refusing unless it is still in one of `from`.
 * Every status change goes through here so the history is complete.
 */
async function moveStatus(db, request, to, { from, action, detail = null, actor, sets = {} }) {
  const allowed = Array.isArray(from) ? from : [from];
  if (!allowed.includes(request.status)) {
    throw new LoanError(
      `Loan request ${request.request_number} is ${request.status}; expected ${allowed.join(' or ')}`,
      409,
      { code: 'LOAN_STATUS_CONFLICT', current_status: request.status }
    );
  }
  const cols = Object.keys(sets);
  const params = [request.id, to, request.status];
  const assignments = cols.map((c, i) => {
    params.push(sets[c]);
    return `${c} = $${i + 4}`;
  });
  const r = await db.query(
    `UPDATE support_loan_requests
        SET status = $2, ${assignments.length ? `${assignments.join(', ')},` : ''} updated_at = NOW()
      WHERE id = $1 AND status = $3
      RETURNING *`,
    params
  );
  if (!r.rows[0]) {
    throw new LoanError('Loan request changed while saving — reload and retry', 409, { code: 'LOAN_STATUS_CONFLICT' });
  }
  await logEvent(db, { requestId: request.id, from: request.status, to, action, detail, actor });
  return r.rows[0];
}

async function ttsplNote(db, serial, eventType, description, metadata, actor) {
  if (!serial) return;
  await logTtsplEvent({
    ttsplId: serial.ttspl_id || serial.inventory_asset_code,
    vendorSerialId: serial.serial_id,
    eventType,
    description,
    metadata,
    actorUserId: actor.user_id,
    actorName: actor.name,
    db,
  });
}

// ── repair context ──────────────────────────────────────────────────────────

function isRepairPickup(item) {
  return item.item_type === 'pickup'
    && (item.pickup_type || (item.source_item_id ? 'repair' : null)) === 'repair';
}

function pickupHasLeftCustomer(item) {
  return Boolean(item.picked_up_at || item.warehouse_received_at || PICKED_UP_ITEM_STATUSES.has(item.status));
}

/** Original laptop + the rental it belongs to, for one repair pickup item. */
async function resolveOriginal(db, ticket, item) {
  const { resolveSerialForPickupItem } = require('./supportServiceDcService');
  const vsn = await resolveSerialForPickupItem(db, item);
  const serial = vsn ? await loadSerial(db, vsn.serial_id) : null;
  const { loadDeliveryDefaults } = require('./supportReplacementFlowService');
  const defaults = await loadDeliveryDefaults(db, ticket, item);
  return { serial, defaults };
}

/** Is the original laptop repaired (floor work finished, back in stock or already on its SDC)? */
async function evaluateRepairCompletion(db, request) {
  const reasons = [];
  const itemRes = await db.query(`SELECT * FROM support_ticket_items WHERE id = $1`, [request.pickup_item_id]);
  const item = itemRes.rows[0];
  if (!item) return { done: false, reasons: ['repair pickup item not found'] };
  if (!item.warehouse_received_at) reasons.push('original laptop not yet received at the warehouse');
  const serial = request.original_serial_id ? await loadSerial(db, request.original_serial_id) : null;
  if (!serial) {
    reasons.push('original laptop not found in inventory');
  } else {
    const { findOpenFloorTicket } = require('./supportServiceDcService');
    const open = await findOpenFloorTicket(db, serial);
    if (open) reasons.push(`floor ticket #${open.ticket_id} is still ${open.stage_name || open.status}`);
    const onSdc = Boolean(item.service_dc_number);
    if (!onSdc && serial.inventory_status !== 'in_stock') {
      reasons.push(`original laptop is ${serial.inventory_status || 'unknown'}, not back in stock`);
    }
  }
  return {
    done: reasons.length === 0,
    reasons,
    original_received: Boolean(item.warehouse_received_at),
    service_dc_number: item.service_dc_number || null,
  };
}

/**
 * A loan can now be live before its repair pickup is collected, so cancelling
 * that pickup (or its ticket) would orphan the loan. Refuse until the loan is
 * cancelled or closed. `itemIds` null = every pickup on the ticket.
 */
async function assertNoLiveLoanForPickups(db, { ticketId, itemIds = null }) {
  if (!(await require('./loanSchema').loanSchemaReady(db))) return;
  const r = await db.query(
    `SELECT request_number, status FROM support_loan_requests
      WHERE ticket_id = $1
        AND ($2::int[] IS NULL OR pickup_item_id = ANY($2::int[]))
        AND status NOT IN ('rejected', 'cancelled', 'returned', 'converted')
      ORDER BY id LIMIT 1`,
    [ticketId, itemIds && itemIds.length ? itemIds.map(Number) : (itemIds ? [0] : null)]
  );
  const live = r.rows[0];
  if (live) {
    throw new LoanError(
      `Loan ${live.request_number} (${live.status}) is linked to this repair pickup — cancel or close the loan first`,
      409,
      { code: 'LOAN_LINKED' }
    );
  }
}

async function getTicketLoanContext(db, ticketId) {
  await assertLoanSchema(db);
  const t = await db.query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
  const ticket = t.rows[0];
  if (!ticket) throw new LoanError('Ticket not found', 404);

  const items = await db.query(
    `SELECT * FROM support_ticket_items
      WHERE ticket_id = $1 AND item_type = 'pickup'
        AND COALESCE(status, '') NOT IN ('cancelled')
      ORDER BY id ASC`,
    [ticketId]
  );
  const loans = await listLoanRequests(db, { ticketId, limit: 50 });
  const activeByItem = new Map(
    loans.rows.filter((l) => l.status !== STATUS.REJECTED && l.status !== STATUS.CANCELLED && l.status !== STATUS.RETURNED)
      .map((l) => [Number(l.pickup_item_id), l])
  );

  const eligible = [];
  for (const item of items.rows) {
    if (!isRepairPickup(item)) continue;
    const reasons = [];
    // The loan may go out before the original is collected: the repair pickup
    // and the Loan DC are tracked independently on the same ticket.
    if (['resolved', 'closed'].includes(item.status)) reasons.push(`repair pickup is ${item.status}`);
    if (ticket.status === 'closed' || ticket.status === 'cancelled') reasons.push(`ticket is ${ticket.status}`);
    if (activeByItem.has(Number(item.id))) {
      reasons.push(`loan ${activeByItem.get(Number(item.id)).request_number} already exists`);
    }
    const { serial, defaults } = await resolveOriginal(db, ticket, item);
    if (!serial) reasons.push('original laptop not found in inventory');
    else if (Number(serial.current_customer_id) !== Number(ticket.customer_id)) {
      reasons.push('original laptop is no longer linked to this customer');
    }
    eligible.push({
      item_id: item.id,
      status: item.status,
      ttspl_id: item.ttspl_id || item.unique_serial_number,
      serial_number: item.serial_number,
      picked_up_at: item.picked_up_at,
      warehouse_received_at: item.warehouse_received_at,
      original_collected: pickupHasLeftCustomer(item),
      original: serial ? {
        serial_id: serial.serial_id,
        ttspl_id: serial.ttspl_id,
        serial_number: serial.serial_number,
        inventory_status: serial.inventory_status,
        rent_monthly_rate: serial.rent_monthly_rate != null ? Number(serial.rent_monthly_rate) : null,
        spec: serial.spec,
      } : null,
      delivery_defaults: defaults,
      eligible: reasons.length === 0,
      reasons,
    });
  }
  return { ticket: { id: ticket.id, customer_id: ticket.customer_id, customer_name: ticket.customer_name, status: ticket.status }, pickups: eligible, loans: loans.rows };
}

/**
 * In-stock, QC-passed laptops not promised to any live loan, each with the
 * policy outcome against the original laptop of `pickupItemId`.
 */
async function listAvailableLaptops(db, { pickupItemId, q = '', limit = 50 }) {
  await assertLoanSchema(db);
  const itemRes = await db.query(`SELECT * FROM support_ticket_items WHERE id = $1`, [pickupItemId]);
  const item = itemRes.rows[0];
  if (!item) throw new LoanError('Repair pickup not found', 404);
  const t = await db.query(`SELECT * FROM support_tickets WHERE id = $1`, [item.ticket_id]);
  const { serial: original } = await resolveOriginal(db, t.rows[0], item);

  const params = [];
  let search = '';
  const term = String(q || '').trim();
  if (term) {
    params.push(`%${term}%`);
    search = `AND (vsn.inventory_asset_code ILIKE $1 OR vsn.serial_number ILIKE $1
                   OR vsn.extra->>'model' ILIKE $1 OR vsn.extra->>'model_name' ILIKE $1
                   OR vsn.extra->>'processor' ILIKE $1 OR vsn.extra->>'brand' ILIKE $1)`;
  }
  params.push(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200));
  const r = await db.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code AS ttspl_id, vsn.extra,
            vsn.inventory_status, vsn.qc_status
       FROM vendor_serial_numbers vsn
      WHERE vsn.deleted_at IS NULL
        AND vsn.inventory_status = 'in_stock'
        AND vsn.current_customer_id IS NULL
        AND vsn.qc_status = 'passed'
        AND COALESCE(vsn.inventory_asset_code, '') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM support_loan_requests lr
           WHERE lr.loan_serial_id = vsn.serial_id
             AND lr.status NOT IN ('rejected', 'cancelled', 'returned', 'converted')
        )
        ${search}
      ORDER BY vsn.inventory_asset_code ASC
      LIMIT $${params.length}`,
    params
  );
  const policy = await policyService.loadPolicy(db);
  const originalSpec = original?.spec || {};
  return {
    original: original ? { serial_id: original.serial_id, ttspl_id: original.ttspl_id, spec: originalSpec } : null,
    laptops: r.rows.map((row) => {
      const spec = specFromSerial(row);
      return {
        serial_id: row.serial_id,
        ttspl_id: row.ttspl_id,
        serial_number: row.serial_number,
        spec,
        policy: policyService.evaluatePolicy({ originalSpec, loanSpec: spec, rules: policy.rules, tiers: policy.tiers }),
      };
    }),
  };
}

// ── 1. create ───────────────────────────────────────────────────────────────

async function createLoanRequest(db, {
  ticketId, pickupItemId, loanSerialId, deliveryAddress = null, contactName = null,
  contactPhone = null, remarks = null, actor,
}) {
  await assertLoanSchema(db);
  if (!pickupItemId || !loanSerialId) throw new LoanError('pickup_item_id and loan_serial_id are required');

  const itemRes = await db.query(
    `SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2 FOR UPDATE`,
    [pickupItemId, ticketId]
  );
  const item = itemRes.rows[0];
  if (!item) throw new LoanError('Repair pickup not found on this ticket', 404);
  const ticketRes = await db.query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
  const ticket = ticketRes.rows[0];
  if (!isRepairPickup(item)) throw new LoanError('A loan laptop can only be issued against a repair pickup');
  if (['cancelled', 'resolved', 'closed'].includes(item.status)) throw new LoanError(`Repair pickup is ${item.status}`);
  if (['closed', 'cancelled'].includes(ticket.status)) throw new LoanError(`Ticket is ${ticket.status}`);

  const existing = await db.query(
    `SELECT request_number, status FROM support_loan_requests
      WHERE pickup_item_id = $1 AND status NOT IN ('rejected', 'cancelled', 'returned')
      LIMIT 1`,
    [pickupItemId]
  );
  if (existing.rows[0]) {
    throw new LoanError(`Loan ${existing.rows[0].request_number} is already ${existing.rows[0].status} for this pickup`, 409, { code: 'LOAN_EXISTS' });
  }

  const { serial: original, defaults } = await resolveOriginal(db, ticket, item);
  if (!original) throw new LoanError('The original laptop could not be found in inventory');
  if (Number(original.current_customer_id) !== Number(ticket.customer_id)) {
    throw new LoanError('The original laptop is no longer linked to this customer');
  }

  const loan = await loadSerial(db, loanSerialId, { forUpdate: true });
  if (!loan) throw new LoanError('Loan laptop not found', 404);
  if (Number(loan.serial_id) === Number(original.serial_id)) throw new LoanError('The loan laptop cannot be the laptop under repair');
  if (loan.inventory_status !== 'in_stock' || loan.current_customer_id) {
    throw new LoanError(`${loan.ttspl_id || loan.serial_number} is not available (status ${loan.inventory_status || 'unknown'})`, 409);
  }
  if (loan.qc_status !== 'passed') throw new LoanError(`${loan.ttspl_id} has not passed QC`, 409);

  const verdict = await policyService.evaluateForSpecs(db, original.spec, loan.spec);
  if (!verdict.allowed) {
    throw new LoanError(`Replacement policy does not allow this laptop: ${verdict.reason}`, 422, { policy: verdict });
  }

  const addr = parseJson(deliveryAddress) || {
    name: defaults.contact_name || null,
    phone: defaults.contact_phone || null,
    address: defaults.address || null,
    city: defaults.city || null,
    state: defaults.state || null,
    pincode: defaults.pincode || null,
  };
  if (!String(addr.address || '').trim()) throw new LoanError('Delivery address is required');

  const requestNumber = await nextFinancialYearNumber('loan_request', db);
  const actorRow = actorOf(actor);
  let inserted;
  try {
    inserted = await db.query(
      `INSERT INTO support_loan_requests (
         request_number, status, ticket_id, pickup_item_id, customer_id, customer_name,
         original_serial_id, original_ttspl_id, original_serial_number, original_spec,
         original_rent_monthly_rate, original_sales_order_number, original_dc_number,
         loan_serial_id, loan_ttspl_id, loan_serial_number, loan_spec,
         delivery_address, contact_name, contact_phone, request_remarks,
         policy_rule_id, policy_rule_name, policy_decision, policy_detail, approval_required,
         created_by)
       VALUES ($1,'requested',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16::jsonb,
               $17::jsonb,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26)
       RETURNING *`,
      [
        requestNumber, ticketId, pickupItemId, ticket.customer_id, ticket.customer_name || null,
        original.serial_id, original.ttspl_id, original.serial_number, JSON.stringify(original.spec),
        original.rent_monthly_rate, defaults.sales_order_number || ticket.sales_order_number || null,
        defaults.original_dc_number || ticket.dc_number || null,
        loan.serial_id, loan.ttspl_id, loan.serial_number, JSON.stringify(loan.spec),
        JSON.stringify(addr), contactName || addr.name || null, contactPhone || addr.phone || null,
        remarks ? String(remarks).slice(0, 2000) : null,
        verdict.rule_id, verdict.rule_name, verdict.decision, JSON.stringify(verdict), verdict.approval_required,
        actorRow.user_id,
      ]
    );
  } catch (e) {
    if (e.code === '23505') {
      throw new LoanError('This laptop or this repair pickup already has a live loan', 409, { code: 'LOAN_EXISTS' });
    }
    throw e;
  }
  let request = inserted.rows[0];
  await logEvent(db, {
    requestId: request.id, to: STATUS.REQUESTED, action: 'requested', actor: actorRow,
    detail: { loan_ttspl_id: loan.ttspl_id, original_ttspl_id: original.ttspl_id, policy: { decision: verdict.decision, rule: verdict.rule_name } },
  });

  // Hold the laptop for this loan so nothing else can allocate it meanwhile.
  await inventorySM.transitionAsset(db, {
    serialId: loan.serial_id,
    toStatus: inventorySM.STATUS.RESERVED,
    customerId: ticket.customer_id,
    reason: `Reserved for loan ${requestNumber} (support ticket #${ticketId})`,
    actorUserId: actorRow.user_id,
    actorName: actorRow.name,
  });

  if (verdict.approval_required) {
    request = await moveStatus(db, request, STATUS.PENDING_APPROVAL, {
      from: STATUS.REQUESTED, action: 'approval_required', actor: actorRow,
      detail: { reason: verdict.reason, rule_id: verdict.rule_id },
    });
  } else {
    request = await moveStatus(db, request, STATUS.APPROVED, {
      from: STATUS.REQUESTED, action: 'auto_approved_by_policy', actor: actorRow,
      detail: { reason: verdict.reason, rule_id: verdict.rule_id, approved_rent_monthly_rate: original.rent_monthly_rate },
      // Same tier as the original: if ever kept, it continues at the original's rate.
      sets: { approved_rent_monthly_rate: original.rent_monthly_rate, approved_at: new Date() },
    });
  }

  await logTicketAudit(db, {
    ticketId, itemId: pickupItemId, userId: actorRow.user_id, action: 'loan_requested',
    detail: { loan_request: requestNumber, loan_ttspl_id: loan.ttspl_id, status: request.status },
  });
  await ttsplNote(db, loan, 'loan_requested', `Requested as loan laptop on ${requestNumber} for customer #${ticket.customer_id}`,
    { loan_request: requestNumber, original_ttspl_id: original.ttspl_id, ticket_id: ticketId }, actorRow);
  return request;
}

// ── 2. approval ─────────────────────────────────────────────────────────────

async function approveLoanRequest(db, id, { approvedRate, remarks = null, actor }) {
  await assertLoanSchema(db);
  const request = await lockRequest(db, id);
  // Re-submitting an approval that already went through is a no-op.
  if (request.status !== STATUS.PENDING_APPROVAL && request.approved_at && !TERMINAL.has(request.status)) {
    return { ...request, already: true };
  }
  const rate = parseRate(approvedRate, 'Approved rental price');
  const actorRow = actorOf(actor);
  return moveStatus(db, request, STATUS.APPROVED, {
    from: STATUS.PENDING_APPROVAL, action: 'approved', actor: actorRow,
    detail: { approved_rent_monthly_rate: rate, remarks, note: 'Price applies only if the customer keeps the laptop; nothing is charged during the loan.' },
    sets: {
      approved_rent_monthly_rate: rate,
      approved_by: actorRow.user_id,
      approved_at: new Date(),
      approval_remarks: remarks ? String(remarks).slice(0, 2000) : null,
    },
  });
}

async function releaseReservedLoanLaptop(db, request, reason, actorRow) {
  const loan = await loadSerial(db, request.loan_serial_id, { forUpdate: true });
  if (!loan) return;
  if (['reserved', 'dispatch_ready'].includes(loan.inventory_status)
    && (!loan.current_customer_id || Number(loan.current_customer_id) === Number(request.customer_id))) {
    await inventorySM.backToStock(db, loan.serial_id, { reason, actorUserId: actorRow.user_id, actorName: actorRow.name });
  }
}

async function rejectLoanRequest(db, id, { reason, actor }) {
  await assertLoanSchema(db);
  const text = String(reason || '').trim();
  if (!text) throw new LoanError('A rejection reason is required');
  const request = await lockRequest(db, id);
  if (request.status === STATUS.REJECTED) return { ...request, already: true };
  const actorRow = actorOf(actor);
  const updated = await moveStatus(db, request, STATUS.REJECTED, {
    from: STATUS.PENDING_APPROVAL, action: 'rejected', actor: actorRow, detail: { reason: text },
    sets: { rejected_by: actorRow.user_id, rejected_at: new Date(), rejection_reason: text.slice(0, 2000) },
  });
  await releaseReservedLoanLaptop(db, request, `Loan ${request.request_number} rejected`, actorRow);
  return updated;
}

// ── 3. Loan DC ──────────────────────────────────────────────────────────────

async function createLoanDc(db, id, { dispatch = {}, actor }) {
  await assertLoanSchema(db);
  const request = await lockRequest(db, id);
  if (request.loan_dc_number) {
    return { request, dc_number: request.loan_dc_number, already: true };
  }
  if (request.status !== STATUS.APPROVED) {
    throw new LoanError(`Loan DC can only be generated for an approved loan (current: ${request.status})`, 409);
  }

  const { normalizeDispatch, resolveBillingIdentity } = require('./supportServiceDcService');
  const d = normalizeDispatch(dispatch);
  if (d.dispatchMode === 'technician' && !d.techId) throw new LoanError('Select the technician who will hand over the laptop');

  const loan = await loadSerial(db, request.loan_serial_id, { forUpdate: true });
  if (!loan) throw new LoanError('Loan laptop not found', 404);
  const heldForUs = loan.inventory_status === 'reserved' && Number(loan.current_customer_id) === Number(request.customer_id);
  // in_stock still linked to this customer = a reservation an older inventory
  // self-heal released (salesManagementService.healStaleReservedPassedSerials).
  const free = loan.inventory_status === 'in_stock'
    && (!loan.current_customer_id || Number(loan.current_customer_id) === Number(request.customer_id));
  if (!heldForUs && !free) {
    throw new LoanError(`${loan.ttspl_id} is ${loan.inventory_status}; it can no longer be issued on this loan`, 409);
  }

  const actorRow = actorOf(actor);
  const dcNumber = await nextFinancialYearNumber('loan_dc', db);
  const ticketRes = await db.query(`SELECT * FROM support_tickets WHERE id = $1`, [request.ticket_id]);
  const ticket = ticketRes.rows[0] || {};
  const billing = await resolveBillingIdentity(db, {
    customerId: request.customer_id,
    originalDcNumber: request.original_dc_number,
    salesOrderNumber: request.original_sales_order_number,
  });
  const documentName = await resolveCustomerDocumentName(db, request.customer_id, request.customer_name || ticket.customer_name);
  const entityCode = entityForQuotationType('rental');
  const shipBy = d.dcDispatchMode === 'inhouse' ? 'by_hand'
    : d.dcDispatchMode === 'porter' ? 'by_porter'
      : d.dcDispatchMode === 'courier' ? 'by_courier' : null;
  const entry = `${loan.serial_id}|${loan.serial_number}|${loan.ttspl_id}`;
  const remarks = d.remarks
    || `Loan laptop for support ticket #${request.ticket_id} while ${request.original_ttspl_id || 'the customer laptop'} is repaired (${request.request_number}). Not chargeable.`;

  await db.query(
    `INSERT INTO delivery_challan_lines
        (dc_number, movement_type, support_ticket_id, customer_id, customer_name, email,
         customer_shipping_address, customer_billing_address, gst_number, supply_state,
         brand, model_name, quantity, serial_number,
         dispatch_mode, ship_by, delivery_person_id, courier_name, awb_number,
         porter_tracking_id, porter_order_id,
         sales_order_number, original_dc_number, dc_purpose, remarks,
         status, created_by, created_at, updated_at,
         entity_code, hsn_code, pre_dispatch_qc_passed)
     VALUES ($1,'outbound',$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,
             $10,$11,1,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,
             NULL,NULL,$20,$21,
             'dispatch_ready',$22,NOW(),NOW(),$23,$24,TRUE)`,
    [
      dcNumber, request.ticket_id, request.customer_id, documentName, ticket.ticket_email || null,
      JSON.stringify(parseJson(request.delivery_address) || {}),
      billing.billingAddress ? JSON.stringify(billing.billingAddress) : null,
      billing.gstNumber, billing.supplyState,
      loan.spec.brand, loan.spec.model, JSON.stringify([entry]),
      d.dcDispatchMode, shipBy, d.techId, d.courierName, d.awbNumber, d.porterTrackingId, d.porterOrderId,
      DC_PURPOSE, remarks, actorRow.user_id, entityCode,
      resolveHsnForPersist({ transactionType: 'rental', role: null }),
    ]
  );

  // QC-passed spare leaves on its own challan; no rate is set (never billed).
  await inventorySM.markDispatchReady(db, loan.serial_id, {
    dcNumber,
    customerId: request.customer_id,
    entityCode,
    dispatchMode: d.dcDispatchMode,
    rentMonthlyRate: null,
    actorUserId: actorRow.user_id,
    actorName: actorRow.name,
  });

  try {
    await db.query('SAVEPOINT loan_dc_units');
    await db.query(
      `INSERT INTO dc_shipment_units (dc_number, serial_id, serial_number, ttspl_id, courier_name, awb_number, status)
       VALUES ($1,$2,$3,$4,$5,$6,'dispatch_ready')`,
      [dcNumber, loan.serial_id, loan.serial_number || null, loan.ttspl_id || null, d.courierName, d.awbNumber]
    );
    await db.query('RELEASE SAVEPOINT loan_dc_units');
  } catch (_) {
    await db.query('ROLLBACK TO SAVEPOINT loan_dc_units').catch(() => {});
  }

  const updated = await moveStatus(db, request, STATUS.DC_GENERATED, {
    from: STATUS.APPROVED, action: 'loan_dc_generated', actor: actorRow,
    detail: { dc_number: dcNumber, dispatch_mode: d.dcDispatchMode, technician_user_id: d.techId, courier_name: d.courierName, awb_number: d.awbNumber },
    sets: {
      loan_dc_number: dcNumber,
      loan_dc_created_at: new Date(),
      loan_dc_created_by: actorRow.user_id,
      dispatch_mode: d.dcDispatchMode,
    },
  });
  await logTicketAudit(db, {
    ticketId: request.ticket_id, itemId: request.pickup_item_id, userId: actorRow.user_id,
    action: 'loan_dc_generated', detail: { loan_request: request.request_number, dc_number: dcNumber },
  });
  return { request: updated, dc_number: dcNumber };
}

/** Guard outward scan of an LDC (guardGateValidationService). */
async function onLoanDcDispatched(db, dcNumber, actor = {}) {
  if (!(await require('./loanSchema').loanSchemaReady(db))) return { handled: false };
  const r = await db.query(
    `SELECT * FROM support_loan_requests WHERE loan_dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const request = r.rows[0];
  if (!request) return { handled: false };
  if (request.status !== STATUS.DC_GENERATED) return { handled: true, skipped: request.status };
  await moveStatus(db, request, STATUS.DISPATCHED, {
    from: STATUS.DC_GENERATED, action: 'dispatched', actor: actorOf(actor),
    detail: { dc_number: dcNumber }, sets: { dispatched_at: new Date() },
  });
  return { handled: true };
}

/**
 * Loan DC delivered (salesManagementController.finalizeDeliveryInventory).
 * Laptop goes on_loan — deliberately NOT rented: no billing starts here.
 */
async function onLoanDcDelivered(db, dcNumber, actor = {}) {
  const meta = await db.query(
    `SELECT dc_purpose, customer_id, entity_code, dispatch_mode, dispatched_at, delivered_at,
            delivery_completed_at, serial_number
       FROM delivery_challan_lines
      WHERE dc_number = $1 AND COALESCE(movement_type, 'outbound') = 'outbound'
      LIMIT 1`,
    [dcNumber]
  );
  const dcl = meta.rows[0];
  if (!dcl || dcl.dc_purpose !== DC_PURPOSE) return { handled: false };
  await assertLoanSchema(db);
  const r = await db.query(`SELECT * FROM support_loan_requests WHERE loan_dc_number = $1 FOR UPDATE`, [dcNumber]);
  const request = r.rows[0];
  if (!request) return { handled: true, skipped: 'no loan request for this DC' };
  if ([STATUS.LOAN_ACTIVE, ...TERMINAL].includes(request.status) || request.delivered_at) {
    return { handled: true, already: true };
  }
  const actorRow = actorOf(actor);
  const loan = await loadSerial(db, request.loan_serial_id, { forUpdate: true });
  const deliveredAt = dcl.delivered_at || dcl.delivery_completed_at || new Date();
  if (loan && ['dispatch_ready', 'reserved', 'in_stock'].includes(loan.inventory_status)) {
    // Delivered without a gate outward (admin override): pass through in_transit.
    await inventorySM.markDispatched(db, loan.serial_id, {
      dcNumber, customerId: request.customer_id, entityCode: dcl.entity_code,
      dispatchMode: dcl.dispatch_mode, rentMonthlyRate: null,
      actorUserId: actorRow.user_id, actorName: actorRow.name,
    });
  }
  if (loan) {
    await inventorySM.markLoanDelivered(db, loan.serial_id, {
      dcNumber, customerId: request.customer_id, entityCode: dcl.entity_code,
      dispatchMode: dcl.dispatch_mode, deliveredAt, actorUserId: actorRow.user_id, actorName: actorRow.name,
    });
  }
  let current = request;
  if (current.status === STATUS.DC_GENERATED) {
    current = await moveStatus(db, current, STATUS.DISPATCHED, {
      from: STATUS.DC_GENERATED, action: 'dispatched', actor: actorRow,
      detail: { dc_number: dcNumber, note: 'recorded at delivery (no gate outward scan)' },
      sets: { dispatched_at: dcl.dispatched_at || deliveredAt },
    });
  }
  current = await moveStatus(db, current, STATUS.LOAN_ACTIVE, {
    from: STATUS.DISPATCHED, action: 'delivered', actor: actorRow,
    detail: { dc_number: dcNumber, delivered_at: deliveredAt, billing: 'none — loan laptops are not charged' },
    sets: {
      delivered_at: deliveredAt,
      handover_detail: JSON.stringify({ dc_number: dcNumber, delivered_at: deliveredAt, dispatch_mode: dcl.dispatch_mode }),
    },
  });
  await logTicketAudit(db, {
    ticketId: request.ticket_id, itemId: request.pickup_item_id, userId: actorRow.user_id,
    action: 'loan_delivered', detail: { loan_request: request.request_number, dc_number: dcNumber },
  });
  return { handled: true, request: current };
}

// ── 4. repair completion + decision ─────────────────────────────────────────

async function markRepairCompleted(db, id, { override = false, remarks = null, actor }) {
  await assertLoanSchema(db);
  const request = await lockRequest(db, id);
  if ([STATUS.REPAIR_COMPLETED, STATUS.DECISION_PENDING].includes(request.status)) return { ...request, already: true };
  if (request.status !== STATUS.LOAN_ACTIVE) {
    throw new LoanError(`Repair can only be completed while the loan is active (current: ${request.status})`, 409);
  }
  const check = await evaluateRepairCompletion(db, request);
  const actorRow = actorOf(actor);
  if (!check.done && !override) {
    throw new LoanError(`Original laptop is not repaired yet: ${check.reasons.join('; ')}`, 409, { reasons: check.reasons });
  }
  // The loan may have gone out before the original was collected; an override
  // must never stand in for the warehouse actually receiving it.
  if (!check.original_received) {
    throw new LoanError('The original laptop has not been received at the warehouse yet', 409, { reasons: check.reasons });
  }
  if (!check.done && override && !String(remarks || '').trim()) {
    throw new LoanError('Explain why repair completion is being overridden');
  }
  const done = await moveStatus(db, request, STATUS.REPAIR_COMPLETED, {
    from: STATUS.LOAN_ACTIVE, action: 'repair_completed', actor: actorRow,
    detail: { override: !check.done, reasons: check.reasons, remarks },
    sets: { repair_completed_at: new Date(), repair_completed_by: actorRow.user_id },
  });
  return moveStatus(db, done, STATUS.DECISION_PENDING, {
    from: STATUS.REPAIR_COMPLETED, action: 'awaiting_customer_decision', actor: actorRow,
  });
}

function normalizeConfirmation(raw, { required }) {
  const c = parseJson(raw) || {};
  const method = String(c.method || '').trim();
  const confirmedBy = String(c.confirmed_by || '').trim();
  if (required || method || confirmedBy) {
    if (!CONFIRMATION_METHODS.includes(method)) {
      throw new LoanError(`Customer confirmation method must be one of ${CONFIRMATION_METHODS.join(', ')}`);
    }
    if (!confirmedBy) throw new LoanError('Name the customer contact who confirmed the decision');
  }
  if (!method) return null;
  return {
    method,
    confirmed_by: confirmedBy.slice(0, 160),
    reference: c.reference ? String(c.reference).slice(0, 300) : null,
    confirmed_at: c.confirmed_at ? parseYmd(c.confirmed_at, 'Confirmation date') : istYmd(),
    notes: c.notes ? String(c.notes).slice(0, 2000) : null,
  };
}

/** Option A: create the loan laptop's return pickup on its own pickup ticket. */
async function createLoanReturnPickup(db, request, returnPickup, actorRow) {
  const supportController = require('../controllers/supportController');
  const loan = await loadSerial(db, request.loan_serial_id, { forUpdate: true });
  if (!loan || loan.inventory_status !== inventorySM.STATUS.ON_LOAN) {
    throw new LoanError(`Loan laptop is ${loan?.inventory_status || 'missing'}, not on loan`, 409);
  }
  const src = await db.query(`SELECT * FROM support_tickets WHERE id = $1`, [request.ticket_id]);
  const origin = src.rows[0] || {};
  const ticketRes = await db.query(
    `INSERT INTO support_tickets (
        customer_id, customer_name, customer_phone, status, created_by, last_activity_at,
        priority, top_level_remarks, ticket_phone_override, ticket_email, ticket_address,
        ticket_category, ttspl_id, serial_number, complaint_type, ticket_contact_name)
     VALUES ($1,$2,$3,'in_progress',$4,CURRENT_TIMESTAMP,'normal',$5,$6,$7,$8,
             'pickup',$9,$10,'pickup',$11)
     RETURNING *`,
    [
      request.customer_id, origin.customer_name || request.customer_name, origin.customer_phone || null,
      actorRow.user_id,
      `Return of loan laptop ${loan.ttspl_id} (${request.request_number}, repair ticket #${request.ticket_id})`,
      request.contact_phone || origin.ticket_phone_override || null, origin.ticket_email || null,
      origin.ticket_address || null, loan.ttspl_id, loan.serial_number, request.contact_name || null,
    ]
  );
  const ticket = ticketRes.rows[0];
  const result = await supportController.executePickupWithReturnDc(db, ticket, ticket.id, actorRow.user_id, {
    pickup_type: 'return',
    dc_purpose: RETURN_DC_PURPOSE,
    pickup_address: parseJson(returnPickup.pickup_address) || parseJson(request.delivery_address),
    dispatch_mode: returnPickup.dispatch_mode,
    technician_user_id: returnPickup.technician_user_id,
    courier_name: returnPickup.courier_name,
    awb_number: returnPickup.awb_number,
    porter_tracking_id: returnPickup.porter_tracking_id,
    porter_order_id: returnPickup.porter_order_id,
    remarks: `Loan laptop return — ${request.request_number}`,
    machines: [{
      serial_number: loan.serial_number,
      ttspl_id: loan.ttspl_id,
      unique_serial_number: loan.ttspl_id,
      brand: loan.spec.brand,
      model: loan.spec.model,
      ram: loan.spec.ram,
      storage: loan.spec.storage,
      generation: loan.spec.generation,
    }],
  });
  return { ticketId: ticket.id, pickupItemId: result.pickupItemId, rdcNumber: result.rdc };
}

async function recordCustomerDecision(db, id, {
  decision, confirmation = null, returnPickup = null, serviceDc = null,
  proposedEffectiveDate = null, proposedRate = null, remarks = null, actor,
}) {
  await assertLoanSchema(db);
  if (!['return_loan', 'keep_loan'].includes(decision)) {
    throw new LoanError('decision must be return_loan (customer takes the repaired laptop back) or keep_loan');
  }
  const request = await lockRequest(db, id);
  if (request.customer_decision === decision
    && [STATUS.RETURN_IN_PROGRESS, STATUS.RETURNED, STATUS.CONVERSION_PENDING_APPROVAL, STATUS.CONVERTED].includes(request.status)) {
    return { request, already: true };
  }
  if (request.status !== STATUS.DECISION_PENDING) {
    throw new LoanError(`A customer decision can only be recorded once repair is complete (current: ${request.status})`, 409);
  }
  const actorRow = actorOf(actor);
  const conf = normalizeConfirmation(confirmation, { required: decision === 'keep_loan' });
  const baseSets = {
    customer_decision: decision,
    decision_recorded_by: actorRow.user_id,
    decision_recorded_at: new Date(),
    customer_confirmation: conf ? JSON.stringify(conf) : null,
  };

  if (decision === 'return_loan') {
    const rp = returnPickup || {};
    if (!['technician', 'courier', 'porter'].includes(rp.dispatch_mode)) {
      throw new LoanError('Choose how the loan laptop will be collected (technician, courier or porter)');
    }
    if (rp.dispatch_mode === 'technician' && !rp.technician_user_id) {
      throw new LoanError('Select the technician who will collect the loan laptop');
    }
    const pickup = await createLoanReturnPickup(db, request, rp, actorRow);

    // The repaired original goes back on the existing Service DC, created here
    // when asked (same dispatch run) or later from the repair ticket.
    let sdcNumber = null;
    const item = (await db.query(`SELECT service_dc_number FROM support_ticket_items WHERE id = $1`, [request.pickup_item_id])).rows[0];
    if (item?.service_dc_number) {
      sdcNumber = item.service_dc_number;
    } else if (serviceDc && serviceDc.create) {
      const sdcService = require('./supportServiceDcService');
      const sdc = await sdcService.createServiceDc(db, {
        ticketId: request.ticket_id,
        itemIds: [request.pickup_item_id],
        dispatch: serviceDc,
        actor: actorRow,
      });
      sdcNumber = sdc.sdcNumber;
    }

    const updated = await moveStatus(db, request, STATUS.RETURN_IN_PROGRESS, {
      from: STATUS.DECISION_PENDING, action: 'customer_returns_loan', actor: actorRow,
      detail: { confirmation: conf, loan_return_ticket_id: pickup.ticketId, loan_return_dc_number: pickup.rdcNumber, service_dc_number: sdcNumber, remarks },
      sets: {
        ...baseSets,
        loan_return_ticket_id: pickup.ticketId,
        loan_return_pickup_item_id: pickup.pickupItemId,
        loan_return_dc_number: pickup.rdcNumber,
        original_service_dc_number: sdcNumber,
      },
    });
    await logTicketAudit(db, {
      ticketId: request.ticket_id, itemId: request.pickup_item_id, userId: actorRow.user_id,
      action: 'loan_return_initiated',
      detail: { loan_request: request.request_number, return_ticket_id: pickup.ticketId, return_dc: pickup.rdcNumber, service_dc: sdcNumber },
    });
    return { request: updated, loan_return_ticket_id: pickup.ticketId, loan_return_dc_number: pickup.rdcNumber, service_dc_number: sdcNumber };
  }

  // keep_loan → Accounts must approve price + effective date before anything bills.
  const rate = proposedRate != null && proposedRate !== ''
    ? parseRate(proposedRate, 'Proposed rental price')
    : (request.approved_rent_monthly_rate != null ? Number(request.approved_rent_monthly_rate) : null);
  const effective = proposedEffectiveDate ? parseYmd(proposedEffectiveDate, 'Proposed effective date') : istYmd();
  const updated = await moveStatus(db, request, STATUS.CONVERSION_PENDING_APPROVAL, {
    from: STATUS.DECISION_PENDING, action: 'customer_keeps_loan', actor: actorRow,
    detail: { confirmation: conf, proposed_effective_date: effective, proposed_rent_monthly_rate: rate, remarks },
    sets: { ...baseSets, proposed_effective_date: effective, proposed_rent_monthly_rate: rate },
  });
  await logTicketAudit(db, {
    ticketId: request.ticket_id, itemId: request.pickup_item_id, userId: actorRow.user_id,
    action: 'loan_keep_requested', detail: { loan_request: request.request_number, proposed_effective_date: effective },
  });
  return { request: updated };
}

// ── Option A completion ─────────────────────────────────────────────────────

/** Warehouse received the loan laptop's return pickup (supportController). */
async function onLoanReturnWarehouseReceived(db, pickupItem, actor = {}) {
  if (!(await require('./loanSchema').loanSchemaReady(db))) return { handled: false };
  const r = await db.query(
    `SELECT * FROM support_loan_requests WHERE loan_return_pickup_item_id = $1 FOR UPDATE`,
    [pickupItem.id]
  );
  const request = r.rows[0];
  if (!request) return { handled: false };
  if (request.status === STATUS.RETURNED) return { handled: true, already: true };
  const actorRow = actorOf(actor);
  const updated = await moveStatus(db, request, STATUS.RETURNED, {
    from: STATUS.RETURN_IN_PROGRESS, action: 'loan_laptop_received', actor: actorRow,
    detail: {
      return_dc_number: request.loan_return_dc_number,
      floor_ticket_id: pickupItem.floor_ticket_id || null,
      billing: 'none — loan was never charged',
      next: 'QC re-entry returns the laptop to stock',
    },
    sets: { loan_returned_at: new Date() },
  });
  await logTicketAudit(db, {
    ticketId: request.ticket_id, itemId: request.pickup_item_id, userId: actorRow.user_id,
    action: 'loan_returned', detail: { loan_request: request.request_number, return_dc: request.loan_return_dc_number },
  });
  return { handled: true, request: updated };
}

// ── Option B: Accounts approves the conversion ──────────────────────────────

async function closeRepairTicketForConversion(db, request, actorRow) {
  await db.query(
    `UPDATE support_ticket_items
        SET status = 'inventory_updated',
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status NOT IN ('cancelled')`,
    [request.pickup_item_id]
  );
  await db.query(
    `UPDATE support_ticket_items
        SET status = 'resolved',
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = $1
        AND item_type = 'complaint'
        AND status NOT IN ('resolved', 'closed', 'inventory_updated', 'cancelled')`,
    [request.ticket_id]
  );
  const open = await db.query(
    `SELECT COUNT(*)::int AS n FROM support_ticket_items
      WHERE ticket_id = $1 AND status NOT IN ('resolved', 'closed', 'inventory_updated', 'cancelled')`,
    [request.ticket_id]
  );
  if (open.rows[0].n === 0) {
    await db.query(
      `UPDATE support_tickets
          SET status = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
              closed_by = COALESCE(closed_by, $2), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status NOT IN ('closed', 'cancelled')`,
      [request.ticket_id, actorRow.user_id]
    );
  }
}

async function approveConversion(db, id, {
  rentMonthlyRate, effectiveDate, retroactiveAuthorized = false, retroactiveReason = null, remarks = null, actor,
}) {
  await assertLoanSchema(db);
  const request = await lockRequest(db, id);
  if (request.status === STATUS.CONVERTED) return { request, already: true };
  if (request.status !== STATUS.CONVERSION_PENDING_APPROVAL) {
    throw new LoanError(`Conversion can only be approved after the customer chose to keep the laptop (current: ${request.status})`, 409);
  }
  const actorRow = actorOf(actor);
  const rate = parseRate(
    rentMonthlyRate ?? request.proposed_rent_monthly_rate ?? request.approved_rent_monthly_rate,
    'Rental price'
  );
  const effective = parseYmd(effectiveDate || request.proposed_effective_date, 'Effective date');
  const today = istYmd();
  const deliveredYmd = request.delivered_at ? istYmd(request.delivered_at) : null;
  if (deliveredYmd && effective < deliveredYmd) {
    throw new LoanError(`Effective date cannot be before the loan laptop was delivered (${deliveredYmd})`);
  }
  const retro = effective < today;
  if (retro && !retroactiveAuthorized) {
    throw new LoanError(
      `Effective date ${effective} is in the past. Rental is not charged retroactively unless explicitly authorised.`,
      422,
      { code: 'RETROACTIVE_NOT_AUTHORISED' }
    );
  }
  if (retro && !String(retroactiveReason || '').trim()) {
    throw new LoanError('Give the reason a retroactive effective date is authorised');
  }
  const originalEnd = addDaysYmd(effective, -1);

  const loan = await loadSerial(db, request.loan_serial_id, { forUpdate: true });
  if (!loan || loan.inventory_status !== inventorySM.STATUS.ON_LOAN
    || Number(loan.current_customer_id) !== Number(request.customer_id)) {
    throw new LoanError(`Loan laptop is ${loan?.inventory_status || 'missing'}; only a laptop on loan to this customer can be converted`, 409);
  }
  const duplicate = await db.query(
    `SELECT request_number FROM support_loan_requests
      WHERE id <> $1 AND status = 'converted' AND (loan_serial_id = $2 OR original_serial_id = $3)
      LIMIT 1`,
    [request.id, request.loan_serial_id, request.original_serial_id]
  );
  if (duplicate.rows[0]) {
    throw new LoanError(`Already converted on ${duplicate.rows[0].request_number}`, 409);
  }

  const original = request.original_serial_id ? await loadSerial(db, request.original_serial_id, { forUpdate: true }) : null;
  if (!original) throw new LoanError('Original laptop not found', 404);
  if (Number(original.current_customer_id) !== Number(request.customer_id)) {
    throw new LoanError('The original laptop is no longer linked to this customer', 409);
  }
  if (!['in_stock', 'returned', 'in_repair', 'qc_failed'].includes(original.inventory_status)) {
    throw new LoanError(
      `The original laptop is ${original.inventory_status}; cancel its Service DC before converting`,
      409
    );
  }
  const openSdc = await db.query(
    `SELECT sti.service_dc_number
       FROM support_ticket_items sti
       JOIN delivery_challan_lines dcl ON dcl.dc_number = sti.service_dc_number AND dcl.movement_type = 'outbound'
      WHERE sti.id = $1 AND COALESCE(dcl.status, '') NOT IN ('cancelled', 'rejected')
      LIMIT 1`,
    [request.pickup_item_id]
  );
  if (openSdc.rows[0]) {
    throw new LoanError(`The original laptop is on Service DC ${openSdc.rows[0].service_dc_number}; cancel it before converting`, 409);
  }
  if (original.rent_start_date && originalEnd < istYmd(original.rent_start_date)) {
    throw new LoanError('Effective date falls before the original laptop\'s rental started');
  }

  const before = {
    loan: { status: loan.inventory_status, rent_start_date: loan.rent_start_date, rent_monthly_rate: loan.rent_monthly_rate },
    original: {
      status: original.inventory_status,
      rent_start_date: original.rent_start_date,
      rent_end_date: original.rent_end_date,
      rent_billed_until: original.rent_billed_until,
      rent_monthly_rate: original.rent_monthly_rate,
    },
  };

  // Loan laptop → the customer's active rented laptop from `effective`.
  await inventorySM.convertLoanToRental(db, loan.serial_id, {
    rentStartDate: effective,
    rentMonthlyRate: rate,
    deliveredAt: loan.delivered_at,
    reason: `Loan ${request.request_number} kept by customer — rent from ${effective} at ${rate}/month`,
    actorUserId: actorRow.user_id,
    actorName: actorRow.name,
  });
  // Billing watermark: nothing before the effective date is ever invoiced, and
  // the first bill starts exactly on it (billingSchedulerService trusts it).
  await db.query(
    `UPDATE vendor_serial_numbers SET rent_billed_until = $2::date, updated_at = NOW() WHERE serial_id = $1`,
    [loan.serial_id, originalEnd]
  );

  // Original laptop leaves the customer's deployment: rent ends the day before,
  // and it re-enters QC like any customer return before going back to stock.
  // The customer link stays until QC so the last days can still be invoiced.
  await inventorySM.transitionAsset(db, {
    serialId: original.serial_id,
    toStatus: inventorySM.STATUS.RETURNED,
    rentEndDate: originalEnd,
    reason: `Replaced by loan laptop ${loan.ttspl_id} (${request.request_number}); rent ends ${originalEnd}`,
    actorUserId: actorRow.user_id,
    actorName: actorRow.name,
    allowOverride: true,
  });
  await db.query(
    `UPDATE vendor_serial_numbers SET qc_status = 'pending', updated_at = NOW() WHERE serial_id = $1`,
    [original.serial_id]
  );
  let qcTicketId = null;
  try {
    await db.query('SAVEPOINT loan_original_qc');
    const { createTicketFromReturn } = require('./grnTicketService');
    const tk = await createTicketFromReturn(db, {
      serialId: original.serial_id,
      serialNumber: original.serial_number,
      inventoryAssetCode: original.ttspl_id,
      customerLabel: request.customer_name,
      dcNumber: request.original_dc_number,
      reason: `Customer kept loan laptop (${request.request_number})`,
      specs: {
        brand: original.spec.brand, model: original.spec.model,
        processor: original.spec.processor, ram: original.spec.ram, storage: original.spec.storage,
      },
      actorUserId: actorRow.user_id,
    });
    qcTicketId = tk && tk.ok ? tk.ticket_id : null;
    await db.query('RELEASE SAVEPOINT loan_original_qc');
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT loan_original_qc').catch(() => {});
    console.error('loanLaptop.originalQcTicket', e.message);
  }

  // Refund any prepaid days already invoiced for the original past its end.
  const billing = require('./billingSchedulerService');
  const creditNote = await billing.createReturnCreditNote(db, {
    serialId: original.serial_id,
    returnDate: originalEnd,
    customerId: request.customer_id,
    supportTicketId: request.ticket_id,
    source: 'loan_conversion',
    actorUserId: actorRow.user_id,
  });
  const creditNoteId = creditNote?.credit_note_id || creditNote?.id || null;

  // Status first: the repair hold checks key off a converted loan.
  const updated = await moveStatus(db, request, STATUS.CONVERTED, {
    from: STATUS.CONVERSION_PENDING_APPROVAL, action: 'conversion_approved', actor: actorRow,
    detail: {
      rent_monthly_rate: rate,
      effective_date: effective,
      original_rent_end_date: originalEnd,
      retroactive: retro,
      retroactive_reason: retro ? retroactiveReason : null,
      credit_note_id: creditNoteId,
      original_qc_ticket_id: qcTicketId,
      before,
      remarks,
    },
    sets: {
      conversion_approved_by: actorRow.user_id,
      conversion_approved_at: new Date(),
      conversion_rent_monthly_rate: rate,
      conversion_effective_date: effective,
      retroactive_authorized: retro,
      retroactive_reason: retro ? String(retroactiveReason).slice(0, 2000) : null,
      original_rent_end_date: originalEnd,
      original_credit_note_id: creditNoteId,
      converted_at: new Date(),
    },
  });
  await closeRepairTicketForConversion(db, request, actorRow);

  const meta = { loan_request: request.request_number, customer_id: request.customer_id, effective_date: effective, rate };
  await ttsplNote(db, loan, 'loan_converted_to_rental',
    `Customer kept loan laptop — rental from ${effective} at ${rate}/month (${request.request_number})`, meta, actorRow);
  await ttsplNote(db, original, 'replaced_by_loan_laptop',
    `Replaced by loan laptop ${loan.ttspl_id}; rent ended ${originalEnd} (${request.request_number})`,
    { ...meta, loan_ttspl_id: loan.ttspl_id, original_rent_end_date: originalEnd }, actorRow);
  await logTicketAudit(db, {
    ticketId: request.ticket_id, itemId: request.pickup_item_id, userId: actorRow.user_id,
    action: 'loan_converted',
    detail: { ...meta, original_rent_end_date: originalEnd, credit_note_id: creditNoteId },
  });
  return { request: updated, credit_note_id: creditNoteId, original_qc_ticket_id: qcTicketId };
}

async function rejectConversion(db, id, { reason, actor }) {
  await assertLoanSchema(db);
  const text = String(reason || '').trim();
  if (!text) throw new LoanError('A reason is required');
  const request = await lockRequest(db, id);
  return moveStatus(db, request, STATUS.DECISION_PENDING, {
    from: STATUS.CONVERSION_PENDING_APPROVAL, action: 'conversion_rejected', actor: actorOf(actor),
    detail: { reason: text },
    sets: { customer_decision: null, proposed_effective_date: null, proposed_rent_monthly_rate: null },
  });
}

// ── cancel ──────────────────────────────────────────────────────────────────

async function cancelLoanRequest(db, id, { reason, actor }) {
  await assertLoanSchema(db);
  const text = String(reason || '').trim();
  if (!text) throw new LoanError('A cancellation reason is required');
  const request = await lockRequest(db, id);
  if (request.status === STATUS.CANCELLED) return { ...request, already: true };
  const actorRow = actorOf(actor);

  let refusedDelivery = false;
  if (request.status === STATUS.DISPATCHED && request.loan_dc_number) {
    const dc = await db.query(
      `SELECT status FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [request.loan_dc_number]
    );
    refusedDelivery = ['rejected', 'cancelled'].includes(String(dc.rows[0]?.status || ''));
  }
  if (!CANCELLABLE.has(request.status) && !refusedDelivery) {
    throw new LoanError(`A loan that has left the warehouse cannot be cancelled (current: ${request.status})`, 409);
  }

  if (request.loan_dc_number && !refusedDelivery) {
    const dc = await db.query(
      `SELECT status FROM delivery_challan_lines WHERE dc_number = $1 FOR UPDATE`,
      [request.loan_dc_number]
    );
    const statuses = dc.rows.map((r) => String(r.status || ''));
    if (statuses.some((s) => !['pending', 'processing', 'dispatch_ready', 'cancelled'].includes(s))) {
      throw new LoanError(`Loan DC ${request.loan_dc_number} has already left the warehouse`, 409);
    }
    await db.query(
      `UPDATE delivery_challan_lines SET status = 'cancelled', updated_at = NOW()
        WHERE dc_number = $1 AND status <> 'cancelled'`,
      [request.loan_dc_number]
    );
    await db.query(`UPDATE dc_shipment_units SET status = 'cancelled' WHERE dc_number = $1`, [request.loan_dc_number])
      .catch(() => {});
  }
  if (!refusedDelivery) {
    await releaseReservedLoanLaptop(db, request, `Loan ${request.request_number} cancelled`, actorRow);
  }
  return moveStatus(db, request, STATUS.CANCELLED, {
    from: [...CANCELLABLE, STATUS.DISPATCHED], action: 'cancelled', actor: actorRow,
    detail: { reason: text, loan_dc_number: request.loan_dc_number, refused_delivery: refusedDelivery },
    sets: { cancelled_by: actorRow.user_id, cancelled_at: new Date(), cancellation_reason: text.slice(0, 2000) },
  });
}

// ── read ────────────────────────────────────────────────────────────────────

const QUEUES = Object.freeze({
  pending_approval: [STATUS.PENDING_APPROVAL, STATUS.CONVERSION_PENDING_APPROVAL],
  ready_for_dc: [STATUS.APPROVED],
  in_transit: [STATUS.DC_GENERATED, STATUS.DISPATCHED],
  active: [STATUS.LOAN_ACTIVE, STATUS.REPAIR_COMPLETED, STATUS.DECISION_PENDING, STATUS.RETURN_IN_PROGRESS, STATUS.CONVERSION_PENDING_APPROVAL],
  decision_pending: [STATUS.DECISION_PENDING],
  closed: [STATUS.RETURNED, STATUS.CONVERTED, STATUS.REJECTED, STATUS.CANCELLED],
});

async function listLoanRequests(db, {
  status = null, queue = null, customerId = null, ticketId = null, q = '', limit = 100, offset = 0,
} = {}) {
  await assertLoanSchema(db);
  const where = ['1=1'];
  const params = [];
  const push = (v) => { params.push(v); return `$${params.length}`; };
  if (status) where.push(`lr.status = ${push(String(status))}`);
  if (queue && QUEUES[queue]) where.push(`lr.status = ANY(${push(QUEUES[queue])}::text[])`);
  if (customerId) where.push(`lr.customer_id = ${push(Number(customerId))}`);
  if (ticketId) where.push(`lr.ticket_id = ${push(Number(ticketId))}`);
  const term = String(q || '').trim();
  if (term) {
    const p = push(`%${term}%`);
    where.push(`(lr.request_number ILIKE ${p} OR lr.loan_ttspl_id ILIKE ${p} OR lr.original_ttspl_id ILIKE ${p}
                 OR lr.customer_name ILIKE ${p} OR lr.loan_dc_number ILIKE ${p} OR lr.ticket_id::text = ${push(term)})`);
  }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const { rows } = await db.query(
    `SELECT lr.*, cu.name AS created_by_name, au.name AS approved_by_name,
            vl.inventory_status AS loan_inventory_status,
            vo.inventory_status AS original_inventory_status,
            COUNT(*) OVER() AS total_count
       FROM support_loan_requests lr
       LEFT JOIN users cu ON cu.user_id = lr.created_by
       LEFT JOIN users au ON au.user_id = lr.approved_by
       LEFT JOIN vendor_serial_numbers vl ON vl.serial_id = lr.loan_serial_id
       LEFT JOIN vendor_serial_numbers vo ON vo.serial_id = lr.original_serial_id
      WHERE ${where.join(' AND ')}
      ORDER BY lr.updated_at DESC, lr.id DESC
      LIMIT ${lim} OFFSET ${off}`,
    params
  );
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}

async function queueCounts(db) {
  await assertLoanSchema(db);
  const { rows } = await db.query(`SELECT status, COUNT(*)::int AS n FROM support_loan_requests GROUP BY status`);
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const counts = {};
  for (const [k, statuses] of Object.entries(QUEUES)) {
    counts[k] = statuses.reduce((a, s) => a + (byStatus[s] || 0), 0);
  }
  return { by_status: byStatus, queues: counts };
}

async function getLoanRequest(db, id) {
  await assertLoanSchema(db);
  const { rows } = await db.query(
    `SELECT lr.*, cu.name AS created_by_name, au.name AS approved_by_name, ca.name AS conversion_approved_by_name
       FROM support_loan_requests lr
       LEFT JOIN users cu ON cu.user_id = lr.created_by
       LEFT JOIN users au ON au.user_id = lr.approved_by
       LEFT JOIN users ca ON ca.user_id = lr.conversion_approved_by
      WHERE lr.id = $1`,
    [id]
  );
  const request = rows[0];
  if (!request) throw new LoanError('Loan request not found', 404);
  const [events, loan, original, dcs] = await Promise.all([
    db.query(`SELECT * FROM support_loan_request_events WHERE loan_request_id = $1 ORDER BY created_at ASC, id ASC`, [id]),
    loadSerial(db, request.loan_serial_id),
    request.original_serial_id ? loadSerial(db, request.original_serial_id) : null,
    db.query(
      `SELECT DISTINCT ON (dc_number) dc_number, movement_type, dc_purpose, status, dispatch_mode,
              dispatched_at, delivered_at, warehouse_received_at, pdf_path, created_at
         FROM delivery_challan_lines
        WHERE dc_number = ANY($1::text[])
        ORDER BY dc_number, id`,
      [[request.loan_dc_number, request.loan_return_dc_number, request.original_service_dc_number].filter(Boolean)]
    ),
  ]);
  const slim = (s) => (s ? {
    serial_id: s.serial_id,
    ttspl_id: s.ttspl_id,
    serial_number: s.serial_number,
    inventory_status: s.inventory_status,
    current_customer_id: s.current_customer_id,
    rent_start_date: s.rent_start_date,
    rent_end_date: s.rent_end_date,
    rent_billed_until: s.rent_billed_until,
    rent_monthly_rate: s.rent_monthly_rate != null ? Number(s.rent_monthly_rate) : null,
    spec: s.spec,
  } : null);
  const repair = [STATUS.LOAN_ACTIVE, STATUS.DISPATCHED].includes(request.status)
    ? await evaluateRepairCompletion(db, request)
    : null;
  // The original's collection runs independently of the loan dispatch.
  const pickupRes = await db.query(
    `SELECT sti.id, sti.status, sti.pickup_method, sti.pickup_courier_name, sti.pickup_awb,
            sti.picked_up_at, sti.warehouse_received_at, sti.return_dc_number,
            dcl.dispatch_mode AS rdc_dispatch_mode, dcl.courier_name AS rdc_courier_name,
            dcl.awb_number AS rdc_awb_number, dcl.status AS rdc_status
       FROM support_ticket_items sti
       LEFT JOIN LATERAL (
         SELECT dispatch_mode, courier_name, awb_number, status FROM delivery_challan_lines
          WHERE dc_number = sti.return_dc_number AND movement_type = 'return' LIMIT 1
       ) dcl ON TRUE
      WHERE sti.id = $1`,
    [request.pickup_item_id]
  );
  const p = pickupRes.rows[0];
  return {
    ...request,
    original_pickup: p ? {
      item_id: p.id,
      status: p.status,
      collected: pickupHasLeftCustomer(p),
      picked_up_at: p.picked_up_at,
      warehouse_received_at: p.warehouse_received_at,
      return_dc_number: p.return_dc_number,
      return_dc_status: p.rdc_status,
      method: p.pickup_method || p.rdc_dispatch_mode || null,
      courier_name: p.pickup_courier_name || p.rdc_courier_name || null,
      awb_number: p.pickup_awb || p.rdc_awb_number || null,
    } : null,
    events: events.rows,
    loan_laptop: slim(loan),
    original_laptop: slim(original),
    documents: dcs.rows,
    repair_status: repair,
  };
}

module.exports = {
  DC_PURPOSE,
  RETURN_DC_PURPOSE,
  STATUS,
  QUEUES,
  CONFIRMATION_METHODS,
  LoanError,
  istYmd,
  addDaysYmd,
  getTicketLoanContext,
  assertNoLiveLoanForPickups,
  listAvailableLaptops,
  createLoanRequest,
  approveLoanRequest,
  rejectLoanRequest,
  createLoanDc,
  onLoanDcDispatched,
  onLoanDcDelivered,
  markRepairCompleted,
  recordCustomerDecision,
  onLoanReturnWarehouseReceived,
  approveConversion,
  rejectConversion,
  cancelLoanRequest,
  listLoanRequests,
  queueCounts,
  getLoanRequest,
  evaluateRepairCompletion,
};
