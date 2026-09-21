/**
 * One routine for "Dispatch QC passed, put the unit back on its order"
 * (Part 2.2, bypass-register B, finding D7).
 *
 * This existed twice — qcController.submitQC and
 * ticketPhase2Controller.moveToStage — as the same SQL with different
 * indentation. Both wrote inventory_status raw, so which screen the technician
 * used decided whether the change was audited.
 *
 * The register says to collapse them rather than fix the same bug twice, which
 * is also the whole point of the programme: this codebase's central defect is
 * that everything exists twice.
 */
const { transitionAsset } = require('./inventoryStateMachine');

/**
 * The guard both copies carried, preserved exactly.
 *
 * A unit already with a customer, in transit or returned must NOT be dragged
 * back to `reserved` by a QC pass — the QC ticket is stale by then and the
 * laptop has moved on. The original expressed this as a NOT IN on a COALESCE;
 * it is read and decided here so the single authority stays single.
 */
const NOT_REPLACEABLE = ['rented', 'sold', 'on_demo', 'in_transit', 'returned'];

async function reserveOnQcPass(client, serialId, {
  actorUserId = null, actorName = null, correlationId = null, caller = 'qcPassReservation',
} = {}) {
  if (!serialId) return { applied: false, reason: 'no_serial' };

  const cur = await client.query(
    `SELECT COALESCE(inventory_status, 'in_stock') AS inventory_status
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [serialId]
  );
  if (!cur.rows.length) return { applied: false, reason: 'serial_not_found' };

  const from = String(cur.rows[0].inventory_status);
  if (NOT_REPLACEABLE.includes(from)) {
    return { applied: false, reason: `already ${from}`, from };
  }
  if (from === 'reserved') return { applied: false, reason: 'already reserved', from };

  await transitionAsset(client, {
    serialId,
    toStatus: 'reserved',
    reason: 'Dispatch QC passed — reserved against its sales order',
    actorUserId,
    actorName,
    correlationId,
    // The source is in_stock in the normal case, which the map allows. It can
    // also be a stray value on an older row, which allowOverride covers until
    // Part 2.3 canonicalises the column.
    allowOverride: true,
    caller,
  });

  return { applied: true, from };
}

module.exports = { reserveOnQcPass, NOT_REPLACEABLE };
