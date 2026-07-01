/**
 * Inventory State Machine — the single authority for asset (TTSPL) status.
 *
 * Every status change for a vendor_serial_numbers row MUST go through
 * transitionAsset(). It validates the transition, updates the authoritative
 * row + lifecycle anchor columns, records an inventory_status_transitions row,
 * and logs a TTSPL audit event. Dispatch, billing, support, and QC all call
 * the helpers here so the three historical inventory representations can no
 * longer drift apart.
 *
 * Canonical statuses:
 *   in_stock   — QC-passed, available to allocate
 *   reserved   — attached to a DC, not yet dispatched
 *   in_transit — dispatched, en route (courier)
 *   rented     — delivered under a rental agreement (Rentfoxxy), earning
 *   on_demo    — delivered as a free demo (Rentfoxxy), not yet billed
 *   sold       — delivered as a sale (Gorefurbo)
 *   returned   — came back from customer, pending QC re-entry
 *   in_repair  — on the floor / under repair
 *   qc_failed  — failed QC (may go back to vendor)
 *   scrapped   — dead asset, removed from circulation
 */
const pool = require('../config/db');
const { logTtsplEvent } = require('./ttsplAuditService');

const STATUS = Object.freeze({
  IN_STOCK: 'in_stock',
  RESERVED: 'reserved',
  IN_TRANSIT: 'in_transit',
  RENTED: 'rented',
  ON_DEMO: 'on_demo',
  SOLD: 'sold',
  RETURNED: 'returned',
  IN_REPAIR: 'in_repair',
  QC_FAILED: 'qc_failed',
  SCRAPPED: 'scrapped',
});

// Allowed transitions. null-key entries are reachable from any state (admin
// corrections still flow through here so they are audited).
const ALLOWED = {
  in_stock:   ['reserved', 'in_transit', 'in_repair', 'qc_failed', 'scrapped'], // in_transit = direct dispatch (no explicit reserve)
  reserved:   ['in_transit', 'in_stock'],                 // in_stock = de-allocate
  in_transit: ['rented', 'on_demo', 'sold', 'in_stock'],  // in_stock = dispatch rejected
  on_demo:    ['rented', 'returned'],                     // keep -> rented, return
  rented:     ['returned'],
  sold:       ['returned'],                               // sales return / RMA
  returned:   ['in_stock', 'in_repair', 'qc_failed', 'scrapped'],
  in_repair:  ['in_stock', 'qc_failed', 'scrapped'],
  qc_failed:  ['in_stock', 'in_repair', 'scrapped'],
  scrapped:   [],
};

const CANONICAL_STATUSES = new Set(Object.values(STATUS));

function isAllowed(from, to) {
  if (!from) return true;                 // first time / unknown current state
  if (from === to) return true;           // idempotent re-assertion
  // Legacy / non-canonical values (e.g. a sale disposition like 'normal_sale'
  // that older code wrote into inventory_status) are not real lifecycle states.
  // Allow the move so the unit self-heals to a canonical status — it is still
  // recorded in inventory_status_transitions + the TTSPL audit log.
  if (!CANONICAL_STATUSES.has(from)) return true;
  return (ALLOWED[from] || []).includes(to);
}

async function loadSerial(db, serialId) {
  const r = await db.query(
    `SELECT serial_id, serial_number, inventory_status,
            COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl_id
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [serialId]
  );
  return r.rows[0] || null;
}

/**
 * Core transition. Pass an open pg client as `db` to run inside a caller's
 * transaction (recommended). Returns { ok, from, to } or throws on invalid move.
 */
async function transitionAsset(db, {
  serialId,
  toStatus,
  reason = null,
  dcNumber = null,
  customerId = null,
  entityCode = null,
  dispatchMode = null,
  rentStartDate = null,
  rentEndDate = null,
  rentMonthlyRate = null,
  actorUserId = null,
  actorName = null,
  allowOverride = false,
}) {
  const client = db || pool;
  const serial = await loadSerial(client, serialId);
  if (!serial) throw new Error(`Serial ${serialId} not found`);

  const from = serial.inventory_status || null;
  if (!allowOverride && !isAllowed(from, toStatus)) {
    throw new Error(`Illegal inventory transition ${from} -> ${toStatus} (serial ${serialId})`);
  }

  // Build the column updates relevant to this transition.
  const sets = ['inventory_status = $2', 'status_changed_at = NOW()', 'updated_at = NOW()'];
  const params = [serialId, toStatus];
  let p = 3;
  const add = (col, val) => { sets.push(`${col} = $${p}`); params.push(val); p += 1; };

  if (dcNumber !== null) add('current_dc_number', dcNumber);
  if (entityCode !== null) add('current_entity', entityCode);
  if (dispatchMode !== null) add('dispatch_mode', dispatchMode);

  switch (toStatus) {
    case STATUS.RESERVED:
      if (customerId !== null) add('current_customer_id', customerId);
      break;
    case STATUS.IN_TRANSIT:
      if (customerId !== null) add('current_customer_id', customerId);
      add('dispatched_at', new Date());
      break;
    case STATUS.RENTED:
    case STATUS.SOLD:
      if (customerId !== null) add('current_customer_id', customerId);
      add('delivered_at', new Date());
      if (rentStartDate !== null) add('rent_start_date', rentStartDate);
      if (rentMonthlyRate !== null) add('rent_monthly_rate', rentMonthlyRate);
      break;
    case STATUS.ON_DEMO:
      if (customerId !== null) add('current_customer_id', customerId);
      add('delivered_at', new Date());
      // Demo is free until the customer "keeps" — clear any mistaken rental anchors.
      add('rent_start_date', rentStartDate);
      add('rent_billed_until', null);
      if (rentMonthlyRate !== null) add('rent_monthly_rate', rentMonthlyRate);
      break;
    case STATUS.RETURNED:
      add('returned_at', new Date());
      if (rentEndDate !== null) add('rent_end_date', rentEndDate);
      break;
    case STATUS.IN_STOCK:
      // Back to the shelf: clear customer holding context + billing anchors so a
      // re-rental to a new customer starts a fresh prepaid cycle.
      add('current_customer_id', null);
      add('current_dc_number', null);
      add('current_entity', null);
      add('rent_start_date', null);
      add('rent_end_date', null);
      add('rent_billed_until', null);
      break;
    default:
      break;
  }

  await client.query(
    `UPDATE vendor_serial_numbers SET ${sets.join(', ')} WHERE serial_id = $1`,
    params
  );

  await client.query(
    `INSERT INTO inventory_status_transitions
       (serial_id, ttspl_id, from_status, to_status, reason, dc_number,
        customer_id, entity_code, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [serialId, serial.ttspl_id, from, toStatus, reason, dcNumber,
     customerId, entityCode, actorUserId]
  );

  await logTtsplEvent({
    ttsplId: serial.ttspl_id,
    vendorSerialId: serialId,
    eventType: `status_${toStatus}`,
    description: reason || `Inventory: ${from || 'new'} → ${toStatus}`,
    metadata: { from, to: toStatus, dc_number: dcNumber, customer_id: customerId, entity: entityCode },
    actorUserId,
    actorName,
    db: client,
  });

  return { ok: true, from, to: toStatus, ttspl_id: serial.ttspl_id };
}

/**
 * Rent-start per business rule:
 *   inhouse / porter -> dispatch date (same-day delivery)
 *   courier          -> min(dispatch_date + 3 days, delivered_date)
 * Dates in/out are JS Date or ISO date string (yyyy-mm-dd).
 */
function computeRentStart({ dispatchMode, dispatchedAt, deliveredAt }) {
  const dispatch = dispatchedAt ? new Date(dispatchedAt) : new Date();
  const mode = String(dispatchMode || '').toLowerCase();
  if (mode === 'inhouse' || mode === 'porter') {
    return dispatch;
  }
  // courier (default): T+3 or actual delivery if earlier
  const tPlus3 = new Date(dispatch);
  tPlus3.setDate(tPlus3.getDate() + 3);
  if (deliveredAt) {
    const delivered = new Date(deliveredAt);
    return delivered < tPlus3 ? delivered : tPlus3;
  }
  return tPlus3;
}

const toDateStr = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// ── Convenience wrappers used by callers ────────────────────────────────────

const reserveForDc = (db, serialId, { dcNumber, customerId, entityCode, actorUserId, actorName }) =>
  transitionAsset(db, { serialId, toStatus: STATUS.RESERVED, dcNumber, customerId, entityCode,
    reason: `Reserved on ${dcNumber}`, actorUserId, actorName });

const markDispatched = (db, serialId, { dcNumber, customerId, entityCode, dispatchMode, actorUserId, actorName }) =>
  transitionAsset(db, { serialId, toStatus: STATUS.IN_TRANSIT, dcNumber, customerId, entityCode,
    dispatchMode, reason: `Dispatched on ${dcNumber} (${dispatchMode})`, actorUserId, actorName });

/**
 * Deliver: pick the terminal state from the order type, compute rent start.
 *   quotationType 'sales' -> sold ; 'demo' -> on_demo ; else -> rented
 */
function deliveredStatusForType(quotationType) {
  const t = String(quotationType || 'rental').toLowerCase();
  if (t === 'sales' || t === 'sale') return STATUS.SOLD;
  if (t === 'demo') return STATUS.ON_DEMO;
  return STATUS.RENTED;
}

const markDelivered = async (db, serialId, {
  quotationType, dcNumber, customerId, entityCode, dispatchMode, dispatchedAt, deliveredAt,
  rentMonthlyRate, actorUserId, actorName,
}) => {
  const client = db || pool;
  const serial = await loadSerial(client, serialId);
  if (!serial) throw new Error(`Serial ${serialId} not found`);

  const toStatus = deliveredStatusForType(quotationType);
  const from = serial.inventory_status || null;

  // Demo delivery: unit may still show "rented" if billing backfill or legacy ERP sync
  // ran before POD confirmation. Allow the correction at delivery time.
  const demoFromRented = from === STATUS.RENTED && toStatus === STATUS.ON_DEMO;

  if (!demoFromRented && !isAllowed(from, toStatus)) {
    if ([STATUS.IN_STOCK, STATUS.RESERVED].includes(from)) {
      await markDispatched(client, serialId, {
        dcNumber, customerId, entityCode, dispatchMode, actorUserId, actorName,
      });
    } else {
      throw new Error(`Illegal inventory transition ${from} -> ${toStatus} (serial ${serialId})`);
    }
  }

  // Demo + sale do not start rent; rental does.
  const rentStartDate = toStatus === STATUS.RENTED
    ? toDateStr(computeRentStart({ dispatchMode, dispatchedAt, deliveredAt }))
    : null;

  return transitionAsset(client, {
    serialId,
    toStatus,
    dcNumber,
    customerId,
    entityCode,
    dispatchMode,
    rentStartDate,
    rentMonthlyRate: rentMonthlyRate ?? null,
    reason: demoFromRented
      ? `Demo delivered on ${dcNumber} (corrected from rented)`
      : `Delivered on ${dcNumber}`,
    actorUserId,
    actorName,
    allowOverride: demoFromRented,
  });
};

/** Demo "keep" decision: on_demo -> rented, with the agreed billing start + rate. */
const convertDemoToRental = (db, serialId, { rentStartDate, rentMonthlyRate, actorUserId, actorName }) =>
  transitionAsset(db, { serialId, toStatus: STATUS.RENTED,
    rentStartDate: toDateStr(rentStartDate), rentMonthlyRate: rentMonthlyRate ?? null,
    reason: 'Demo converted to rental (kept)', actorUserId, actorName });

const markReturned = (db, serialId, { reason, rentEndDate, actorUserId, actorName }) =>
  transitionAsset(db, { serialId, toStatus: STATUS.RETURNED, rentEndDate: toDateStr(rentEndDate),
    reason: reason || 'Returned by customer', actorUserId, actorName });

const backToStock = (db, serialId, { reason, actorUserId, actorName }) =>
  transitionAsset(db, { serialId, toStatus: STATUS.IN_STOCK,
    reason: reason || 'Returned to available stock', actorUserId, actorName });

/** Look up the authoritative serial row by TTSPL code or vendor serial number. */
async function findSerialByCode(db, code) {
  if (!code) return null;
  const client = db || pool;
  const r = await client.query(
    `SELECT serial_id, inventory_status, rent_monthly_rate, current_entity
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
      LIMIT 1`,
    [code]
  );
  return r.rows[0] || null;
}

/**
 * Bridge a support replacement into the authoritative inventory:
 *   - the faulty/old unit is marked `returned` (rent stops immediately);
 *   - the replacement unit is delivered as `rented` to the same customer,
 *     carrying the old unit's monthly rate so billing continues seamlessly.
 * Tolerant of missing codes (logs nothing for the absent side).
 */
async function bridgeSupportReplacement(db, {
  oldCode, newCode, customerId, dcNumber = null, actorUserId = null, actorName = null,
}) {
  const result = { returned: null, replaced: null };
  const oldRow = await findSerialByCode(db, oldCode);
  if (oldRow) {
    await markReturned(db, oldRow.serial_id, {
      reason: 'Returned via support replacement', actorUserId, actorName,
    });
    result.returned = oldRow.serial_id;
  }
  const newRow = await findSerialByCode(db, newCode);
  if (newRow) {
    // A spare in stock (or reserved) must pass through in_transit before it can
    // become "rented" per the state machine's allowed transitions.
    if (newRow.inventory_status === 'in_stock' || newRow.inventory_status === 'reserved') {
      await markDispatched(db, newRow.serial_id, {
        dcNumber,
        customerId,
        entityCode: oldRow?.current_entity || 'rentfoxxy',
        dispatchMode: 'inhouse',
        actorUserId,
        actorName,
      });
    }
    await markDelivered(db, newRow.serial_id, {
      quotationType: 'rental',
      dcNumber,
      customerId,
      entityCode: oldRow?.current_entity || 'rentfoxxy',
      dispatchMode: 'inhouse',
      dispatchedAt: new Date(),
      deliveredAt: new Date(),
      rentMonthlyRate: oldRow?.rent_monthly_rate ?? null,
      actorUserId,
      actorName,
    });
    result.replaced = newRow.serial_id;
  }
  return result;
}

module.exports = {
  STATUS,
  ALLOWED,
  isAllowed,
  transitionAsset,
  computeRentStart,
  deliveredStatusForType,
  reserveForDc,
  markDispatched,
  markDelivered,
  markReturned,
  convertDemoToRental,
  backToStock,
  findSerialByCode,
  bridgeSupportReplacement,
};
