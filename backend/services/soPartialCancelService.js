/**
 * Partial sales-order line cancellation.
 *
 * A unit can be cancelled when it has never left on an active DC, or when a
 * rejected return has re-attached the serial (status = attached, no active DC).
 * Units in transit or already delivered cannot be cancelled.
 */
const inventorySM = require('./inventoryStateMachine');
const { recalcSoSecurityIfOneMonthRental } = require('./salesManagementService');

const ACTIVE_DC_STATUSES = Object.freeze([
  'pending', 'processing', 'shipped', 'in_transit', 'reached',
]);

async function loadLine(client, lineId, { forUpdate = false } = {}) {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const r = await client.query(
    `SELECT * FROM sales_order_lines WHERE id = $1${lock}`,
    [lineId]
  );
  return r.rows[0] || null;
}

async function lineSerialMetrics(client, lineId) {
  const r = await client.query(
    `SELECT
        COUNT(*) FILTER (WHERE sos.status = 'attached')::int AS attached,
        COUNT(*) FILTER (
          WHERE sos.status = 'dispatched'
            AND EXISTS (
              SELECT 1 FROM delivery_challan_lines dcl
               WHERE dcl.dc_number = sos.dc_number
                 AND dcl.status = 'delivered'
            )
        )::int AS delivered,
        COUNT(*) FILTER (
          WHERE sos.status = 'dispatched'
            AND EXISTS (
              SELECT 1 FROM delivery_challan_lines dcl
               WHERE dcl.dc_number = sos.dc_number
                 AND COALESCE(dcl.status, '') = ANY($2::text[])
            )
        )::int AS in_transit,
        COUNT(*) FILTER (
          WHERE sos.status IN ('attached', 'dispatched')
        )::int AS allocated
       FROM sales_order_serials sos
      WHERE sos.line_id = $1
        AND sos.status <> 'removed'`,
    [lineId, ACTIVE_DC_STATUSES]
  );
  return r.rows[0] || { attached: 0, delivered: 0, in_transit: 0, allocated: 0 };
}

function buildEligibility(line, metrics) {
  const ordered = Math.max(0, Number(line?.main_qty ?? line?.quantity ?? 0));
  const attached = Number(metrics.attached || 0);
  const delivered = Number(metrics.delivered || 0);
  const inTransit = Number(metrics.in_transit || 0);
  const allocated = Number(metrics.allocated || 0);
  const locked = delivered + inTransit;
  const cancellable = Math.max(0, ordered - locked);
  const pendingSlots = Math.max(0, ordered - allocated);
  const isCancelled = String(line?.status || '').toLowerCase() === 'cancelled';

  return {
    line_id: line?.id,
    sales_order_number: line?.sales_order_number,
    ordered_qty: ordered,
    attached_qty: attached,
    delivered_qty: delivered,
    in_transit_qty: inTransit,
    locked_qty: locked,
    pending_slots: pendingSlots,
    cancellable_qty: cancellable,
    can_cancel: !isCancelled && cancellable > 0,
    line_status: line?.status || 'pending',
  };
}

async function getLineCancelEligibility(client, lineId) {
  const line = await loadLine(client, lineId);
  if (!line) {
    const err = new Error('Sales order line not found');
    err.status = 404;
    throw err;
  }
  const metrics = await lineSerialMetrics(client, lineId);
  return buildEligibility(line, metrics);
}

async function releaseAttachedAllocation(client, alloc, { soNumber, actorUserId, actorName, reason }) {
  if (alloc.serial_id) {
    try {
      await inventorySM.backToStock(client, alloc.serial_id, {
        reason: reason || `Partial cancel on ${soNumber}`,
        actorUserId,
        actorName,
      });
    } catch (_) { /* tolerate non-canonical inventory state */ }
  }
  if (alloc.qc_ticket_id) {
    await client.query(
      `UPDATE tickets SET status = 'cancelled', updated_at = NOW()
        WHERE ticket_id = $1 AND status NOT IN ('completed', 'cancelled')`,
      [alloc.qc_ticket_id]
    );
  }
  await client.query(
    `UPDATE sales_order_serials SET status = 'removed', updated_at = NOW()
      WHERE allocation_id = $1`,
    [alloc.allocation_id]
  );
}

/**
 * Reduce ordered qty on one SO line. Releases attached serials when needed.
 */
async function partialCancelSoLine(client, {
  lineId,
  cancelQty,
  reason,
  actorUserId,
  actorName,
}) {
  const qty = parseInt(cancelQty, 10);
  if (!Number.isFinite(qty) || qty < 1) {
    const err = new Error('cancel_qty must be at least 1');
    err.status = 400;
    throw err;
  }

  const line = await loadLine(client, lineId, { forUpdate: true });
  if (!line) {
    const err = new Error('Sales order line not found');
    err.status = 404;
    throw err;
  }
  if (String(line.status || '').toLowerCase() === 'cancelled') {
    const err = new Error('This line is already cancelled');
    err.status = 409;
    throw err;
  }

  const metrics = await lineSerialMetrics(client, lineId);
  const eligibility = buildEligibility(line, metrics);
  if (qty > eligibility.cancellable_qty) {
    const err = new Error(
      `Cannot cancel ${qty} unit(s). Only ${eligibility.cancellable_qty} can be cancelled `
      + `(delivered or in-transit units cannot be cancelled).`
    );
    err.status = 400;
    throw err;
  }

  const soNumber = line.sales_order_number;
  let remaining = qty;
  const pendingSlotReduction = Math.min(remaining, eligibility.pending_slots);
  remaining -= pendingSlotReduction;

  const released = [];
  if (remaining > 0) {
    const attachedRes = await client.query(
      `SELECT allocation_id, serial_id, qc_ticket_id, ttspl_id, serial_number
         FROM sales_order_serials
        WHERE line_id = $1 AND status = 'attached'
        ORDER BY allocation_id ASC
        LIMIT $2
        FOR UPDATE`,
      [lineId, remaining]
    );
    if (attachedRes.rows.length < remaining) {
      const err = new Error('Not enough attached laptops available to cancel');
      err.status = 409;
      throw err;
    }
    for (const alloc of attachedRes.rows) {
      await releaseAttachedAllocation(client, alloc, {
        soNumber,
        actorUserId,
        actorName,
        reason,
      });
      released.push({
        allocation_id: alloc.allocation_id,
        ttspl_id: alloc.ttspl_id,
        serial_number: alloc.serial_number,
      });
    }
    remaining = 0;
  }

  const orderedBefore = eligibility.ordered_qty;
  const newMainQty = orderedBefore - qty;
  const newQuantity = Math.max(0, Number(line.quantity || orderedBefore) - qty);
  const newStatus = newMainQty <= eligibility.locked_qty && eligibility.locked_qty > 0
    ? 'pending'
    : (newMainQty <= 0 ? 'cancelled' : (line.status || 'pending'));

  await client.query(
    `UPDATE sales_order_lines
        SET main_qty = $2,
            quantity = $3,
            status = $4,
            updated_at = NOW()
      WHERE id = $1`,
    [lineId, newMainQty, newQuantity, newStatus]
  );

  await recalcSoSecurityIfOneMonthRental(client, soNumber);

  const afterMetrics = await lineSerialMetrics(client, lineId);
  const after = buildEligibility(
    { ...line, main_qty: newMainQty, quantity: newQuantity, status: newStatus },
    afterMetrics
  );

  return {
    sales_order_number: soNumber,
    line_id: lineId,
    cancelled_qty: qty,
    pending_slot_reduction: pendingSlotReduction,
    released_serials: released,
    before: eligibility,
    after,
    line_status: newStatus,
    reason: reason || null,
  };
}

module.exports = {
  ACTIVE_DC_STATUSES,
  getLineCancelEligibility,
  partialCancelSoLine,
};
