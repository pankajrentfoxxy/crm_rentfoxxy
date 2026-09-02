/**
 * VRDC transitions fired by the guard gate.
 *
 * Isolated from vendorRepairDcService / guardGateValidationService so the
 * dependency graph stays one-way: both call here; this lazy-requires the
 * inventory wrapper only when an outward confirm actually runs.
 */
const inventorySM = require('./inventoryStateMachine');

function snapshotToExpected(snap) {
  const src = snap && typeof snap === 'object' ? snap : {};
  return {
    brand: src.brand || null,
    model: src.model || null,
    processor: src.processor || null,
    generation: src.generation || null,
    ram: src.ram || null,
    ssd: src.ssd || src.storage || null,
    gpu: src.gpu || null,
  };
}

async function nextReceiveDcNumber(client, dispatchDcNumber) {
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(receive_dc_number, '-R([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM vendor_repair_receive_challans
      WHERE dc_number = $1`,
    [dispatchDcNumber]
  );
  const seq = String(r.rows[0]?.n || 1).padStart(2, '0');
  return `${dispatchDcNumber}-R${seq}`;
}

/**
 * Fired by the guard gate when an OUTWARD VRDC session is confirmed.
 * This is the dispatch event: before this runs the laptop is still ours.
 * Must be called with the caller's open pg client so it joins that transaction.
 */
async function applyOutwardGateVrdc(client, {
  dcNumber, serialIds, sessionId, actorUserId, actorName,
}) {
  const ids = (serialIds || []).map(Number).filter(Boolean);
  if (!dcNumber) return null;

  const headRes = await client.query(
    `SELECT dc_number, vendor_name, status, gate_legacy, COALESCE(item_domain, 'laptop') AS item_domain
       FROM vendor_repair_delivery_challans
      WHERE dc_number = $1
      FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) return null;
  if (String(head.item_domain || 'laptop') !== 'laptop') return null;
  if (head.gate_legacy) return null;

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        status = 'dispatched',
        dispatched_at = COALESCE(dispatched_at, NOW()),
        items_dispatched_count = (SELECT COUNT(*)::int FROM vendor_repair_dc_items WHERE dc_number = $1),
        updated_at = NOW()
      WHERE dc_number = $1
        AND status IN ('dispatch_ready', 'draft')`,
    [dcNumber]
  );

  const itemsRes = await client.query(
    `SELECT i.id, i.ticket_id, i.serial_id, i.ttspl_id, i.item_status,
            t.ttspl_id AS ticket_ttspl, t.vendor_serial_id
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
      WHERE i.dc_number = $1
        AND COALESCE(i.item_status, 'draft') = 'dispatch_ready'
        AND ($2::int[] IS NULL OR cardinality($2::int[]) = 0 OR i.serial_id = ANY($2::int[]))`,
    [dcNumber, ids.length ? ids : null]
  );

  if (!itemsRes.rows.length) return { dc_number: dcNumber, items: 0 };

  const { transitionRepairSerial } = require('./vendorRepairDcService');
  const { logTtsplEvent } = require('./ttsplAuditService');

  await client.query(
    `UPDATE vendor_repair_dc_items SET
        item_status = 'dispatched',
        gate_outward_session_id = COALESCE($2::uuid, gate_outward_session_id),
        gate_outward_at = COALESCE(gate_outward_at, NOW())
      WHERE dc_number = $1
        AND id = ANY($3::int[])`,
    [dcNumber, sessionId || null, itemsRes.rows.map((r) => r.id)]
  );

  for (const item of itemsRes.rows) {
    await client.query(
      `UPDATE tickets SET status = 'out_for_repair', current_location = $2, updated_at = NOW()
        WHERE ticket_id = $1`,
      [item.ticket_id, `Out for repair — ${head.vendor_name}`]
    );
    const serialId = item.vendor_serial_id || item.serial_id;
    if (serialId) {
      await transitionRepairSerial(client, {
        serialId,
        toStatus: inventorySM.STATUS.IN_REPAIR,
        reason: `Out for vendor repair — gate outward ${dcNumber}`,
        dcNumber,
        actorUserId,
        actorName,
        qcStatus: 'out_for_repair',
        extraPatch: {
          location: 'out_for_repair',
          vendor_repair_dc: dcNumber,
          action_status: 'in_repair',
        },
      });
    }
    try {
      await logTtsplEvent({
        ttsplId: item.ttspl_id || item.ticket_ttspl,
        vendorSerialId: serialId,
        eventType: 'dispatched_to_vendor',
        description: `Dispatched to vendor via ${dcNumber}`,
        metadata: { dc_number: dcNumber, vendor_name: head.vendor_name, session_id: sessionId },
        actorUserId,
        actorName,
        db: client,
      });
    } catch (err) {
      console.warn('[vendorRepairGate] outward audit skipped:', err.message);
    }
    await client.query(
      `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes, created_at)
       VALUES ($1, NULL, $2, 'out_for_repair', $3, CURRENT_TIMESTAMP)`,
      [item.ticket_id, actorUserId || null, `Dispatched to ${head.vendor_name} (${dcNumber})`]
    );
  }

  return { dc_number: dcNumber, items: itemsRes.rows.length };
}

/**
 * Fired when an INWARD VRDC / receive-challan session is confirmed.
 * Laptop is inside the gate but NOT in stock until config capture passes.
 */
async function applyInwardGateVrdc(client, {
  receiveDcNumber, dcNumber, serialIds, sessionId, actorUserId,
}) {
  const ids = (serialIds || []).map(Number).filter(Boolean);
  const headRes = await client.query(
    `SELECT dc_number, gate_legacy, COALESCE(item_domain, 'laptop') AS item_domain
       FROM vendor_repair_delivery_challans
      WHERE dc_number = $1
      FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) return null;
  if (String(head.item_domain || 'laptop') !== 'laptop') return null;
  if (head.gate_legacy) return null;

  const itemsRes = await client.query(
    `SELECT i.id, i.ticket_id, i.serial_id, i.ttspl_id, i.serial_number,
            i.dispatch_config_snapshot, i.receive_dc_number, i.item_status
       FROM vendor_repair_dc_items i
      WHERE i.dc_number = $1
        AND COALESCE(i.item_status, '') = 'dispatched'
        AND ($2::int[] IS NULL OR cardinality($2::int[]) = 0 OR i.serial_id = ANY($2::int[]))`,
    [dcNumber, ids.length ? ids : null]
  );
  if (!itemsRes.rows.length) return { dc_number: dcNumber, items: 0 };

  let recvNumber = receiveDcNumber || itemsRes.rows.find((r) => r.receive_dc_number)?.receive_dc_number || null;
  if (!recvNumber) {
    recvNumber = await nextReceiveDcNumber(client, dcNumber);
    await client.query(
      `INSERT INTO vendor_repair_receive_challans
         (dc_number, receive_dc_number, receive_mode, items_count, created_by, gate_inward_at, gate_session_id)
       VALUES ($1, $2, 'repaired', $3, $4, NOW(), $5)
       ON CONFLICT (receive_dc_number) DO NOTHING`,
      [dcNumber, recvNumber, itemsRes.rows.length, actorUserId || null, sessionId || null]
    );
  } else {
    await client.query(
      `UPDATE vendor_repair_receive_challans SET
          gate_inward_at = COALESCE(gate_inward_at, NOW()),
          gate_session_id = COALESCE($2::uuid, gate_session_id),
          items_count = GREATEST(items_count, $3)
        WHERE receive_dc_number = $1`,
      [recvNumber, sessionId || null, itemsRes.rows.length]
    );
  }

  const itemIds = itemsRes.rows.map((r) => r.id);
  await client.query(
    `UPDATE vendor_repair_dc_items SET
        item_status = 'gate_received',
        receive_dc_number = COALESCE(receive_dc_number, $2),
        gate_inward_session_id = COALESCE($3::uuid, gate_inward_session_id),
        gate_inward_at = COALESCE(gate_inward_at, NOW())
      WHERE id = ANY($1::int[])`,
    [itemIds, recvNumber, sessionId || null]
  );

  const { mintTokensForItems } = require('./vendorReturnCaptureService');
  await mintTokensForItems(client, {
    dcNumber,
    receiveDcNumber: recvNumber,
    items: itemsRes.rows.map((row) => ({
      ...row,
      expected_config: snapshotToExpected(row.dispatch_config_snapshot),
    })),
    createdBy: actorUserId || null,
  });

  return {
    dc_number: dcNumber,
    receive_dc_number: recvNumber,
    items: itemsRes.rows.length,
    item_ids: itemIds,
  };
}

module.exports = {
  applyOutwardGateVrdc,
  applyInwardGateVrdc,
  nextReceiveDcNumber,
  snapshotToExpected,
};
