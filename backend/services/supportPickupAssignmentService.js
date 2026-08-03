const pool = require('../config/db');
const { isAssignmentEditable, resolveTechnicianId } = require('./dcAssignmentService');

const DISPATCH_MODES = new Set(['technician', 'courier', 'porter']);

function mapDispatchMode(mode) {
  if (mode === 'technician') {
    return { dcDispatchMode: 'inhouse', shipBy: 'by_hand', pickupMethod: 'technician' };
  }
  if (mode === 'porter') {
    return { dcDispatchMode: 'porter', shipBy: 'by_porter', pickupMethod: 'porter' };
  }
  return { dcDispatchMode: 'courier', shipBy: 'by_courier', pickupMethod: 'courier' };
}

function metaFromBody(body) {
  const dispatchMode = String(body.dispatch_mode || '').toLowerCase();
  const mapped = mapDispatchMode(dispatchMode);
  const techId = dispatchMode === 'technician' && body.technician_user_id
    ? parseInt(body.technician_user_id, 10)
    : null;
  return {
    dispatch_mode: dispatchMode,
    dc_dispatch_mode: mapped.dcDispatchMode,
    ship_by: mapped.shipBy,
    pickup_method: mapped.pickupMethod,
    technician_user_id: Number.isNaN(techId) ? null : techId,
    courier_name: dispatchMode === 'courier' ? (body.courier_name || null) : null,
    awb_number: dispatchMode === 'courier' ? (body.awb_number || null) : null,
    porter_tracking_id: dispatchMode === 'porter'
      ? (body.porter_tracking_id || body.porter_order_id || null)
      : null,
    porter_order_id: dispatchMode === 'porter' ? (body.porter_order_id || null) : null,
  };
}

function metaFromPickupRow(item, dcRow = {}) {
  const dispatchMode = item.pickup_method || (
    dcRow.dispatch_mode === 'inhouse' ? 'technician'
      : dcRow.dispatch_mode === 'porter' ? 'porter'
        : dcRow.dispatch_mode === 'courier' ? 'courier'
          : null
  );
  return metaFromBody({
    dispatch_mode: dispatchMode || 'technician',
    technician_user_id: item.pickup_assigned_to || item.assigned_to || dcRow.delivery_person_id,
    courier_name: item.pickup_courier_name || dcRow.courier_name,
    awb_number: item.pickup_awb || dcRow.awb_number,
    porter_tracking_id: item.porter_tracking_id || dcRow.porter_tracking_id,
    porter_order_id: item.porter_order_id || dcRow.porter_order_id,
  });
}

function metaEqual(a, b) {
  const keys = [
    'dispatch_mode', 'technician_user_id', 'courier_name', 'awb_number',
    'porter_tracking_id', 'porter_order_id',
  ];
  return keys.every((k) => String(a[k] ?? '') === String(b[k] ?? ''));
}

async function assigneeLabel(client, meta) {
  if (meta.dispatch_mode === 'technician') {
    const uid = meta.technician_user_id;
    if (!uid) return 'Unassigned technician';
    const r = await client.query('SELECT name FROM users WHERE user_id = $1', [uid]);
    return r.rows[0]?.name || `Technician #${uid}`;
  }
  if (meta.dispatch_mode === 'porter') {
    const parts = [meta.porter_tracking_id, meta.porter_order_id].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Porter (unassigned)';
  }
  const parts = [meta.courier_name, meta.awb_number].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Courier (unassigned)';
}

function validatePayload(body) {
  const mode = String(body.dispatch_mode || '').toLowerCase();
  if (!DISPATCH_MODES.has(mode)) return 'Select technician, courier, or porter';
  if (mode === 'technician' && !body.technician_user_id) return 'Select a technician';
  if (mode === 'courier') {
    if (!String(body.courier_name || '').trim()) return 'Courier name is required';
    if (!String(body.awb_number || '').trim()) return 'AWB number is required';
  }
  if (mode === 'porter') {
    const id = body.porter_tracking_id || body.porter_order_id;
    if (!String(id || '').trim()) return 'Porter booking / tracking ID is required';
  }
  return null;
}

function pickupStarted(item) {
  return !!(item.visited_at || item.customer_otp_verified_at || item.warehouse_received_at
    || item.technician_esign_at || item.picked_up_at);
}

function isPickupAssignmentEditable(item, dcStatus) {
  if (!item || item.item_type !== 'pickup') return false;
  if (['resolved', 'closed', 'inventory_updated', 'cancelled'].includes(String(item.status || ''))) {
    return false;
  }
  if (pickupStarted(item)) return false;
  if (dcStatus && !isAssignmentEditable(dcStatus)) return false;
  return true;
}

/**
 * Apply or change return pickup assignment (technician / courier / porter).
 * Updates support_ticket_items and linked return delivery_challan_lines.
 */
async function applyReturnPickupAssignment({ ticketId, body, allowChange = true }) {
  const validationError = validatePayload(body);
  if (validationError) {
    return { ok: false, status: 400, message: validationError };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1', [ticketId]);
    if (!ticketRes.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, message: 'Ticket not found' };
    }
    const ticket = ticketRes.rows[0];
    if (!ticket.return_dc_number) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, message: 'No Return DC on this ticket' };
    }

    const dcRes = await client.query(
      `SELECT dc_number, status, dispatch_mode, delivery_person_id,
              courier_name, awb_number, porter_tracking_id, porter_order_id
         FROM delivery_challan_lines
        WHERE dc_number = $1 AND movement_type = 'return'
        LIMIT 1`,
      [ticket.return_dc_number]
    );
    if (!dcRes.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, message: 'Return DC not found' };
    }
    const dcRow = dcRes.rows[0];

    const itemsRes = await client.query(
      `SELECT * FROM support_ticket_items
        WHERE ticket_id = $1 AND item_type = 'pickup' AND return_dc_number = $2`,
      [ticketId, ticket.return_dc_number]
    );
    if (!itemsRes.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, message: 'No pickup items linked to this Return DC' };
    }
    const pickupItems = itemsRes.rows;

    const isInitialAssign = !dcRow.dispatch_mode
      || pickupItems.every((p) => !p.pickup_method && !p.pickup_assigned_to && !p.assigned_to);

    if (!isInitialAssign && !allowChange) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, message: 'Pickup is already assigned for this Return DC' };
    }

    if (!isInitialAssign) {
      const blockedItem = pickupItems.find((p) => !isPickupAssignmentEditable(p, dcRow.status));
      if (blockedItem) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          status: 409,
          message: 'Assignee cannot be changed after pickup has started.',
        };
      }
    }

    const previousMeta = metaFromPickupRow(pickupItems[0], dcRow);
    const nextMeta = metaFromBody(body);

    if (!isInitialAssign && metaEqual(previousMeta, nextMeta)) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, message: 'No assignment changes detected' };
    }

    const previousLabel = await assigneeLabel(client, previousMeta);
    const newLabel = await assigneeLabel(client, nextMeta);
    const reason = body.reason != null ? String(body.reason).trim() || null : null;

    const newDcStatus = nextMeta.dc_dispatch_mode === 'inhouse' ? 'in_transit' : 'shipped';
    const techId = nextMeta.technician_user_id;
    const deliveryPersonId = techId ? await resolveTechnicianId(client, techId) : null;

    await client.query(
      `UPDATE support_ticket_items SET
          assigned_to = $3,
          pickup_assigned_to = $3,
          pickup_method = $4,
          pickup_courier_name = $5,
          pickup_awb = $6,
          porter_tracking_id = $7,
          porter_order_id = $8,
          status = CASE WHEN status = 'pending_dispatch' THEN 'assigned' ELSE status END,
          updated_at = NOW()
       WHERE ticket_id = $1 AND item_type = 'pickup' AND return_dc_number = $2`,
      [
        ticketId,
        ticket.return_dc_number,
        techId,
        nextMeta.pickup_method,
        nextMeta.courier_name,
        nextMeta.awb_number,
        nextMeta.porter_tracking_id,
        nextMeta.porter_order_id,
      ]
    );

    await client.query(
      `UPDATE delivery_challan_lines SET
          dispatch_mode = $2,
          ship_by = $3,
          delivery_person_id = $4,
          courier_name = $5,
          awb_number = $6,
          porter_tracking_id = $7,
          porter_order_id = $8,
          status = $9,
          dispatched_at = COALESCE(dispatched_at, NOW()),
          updated_at = NOW()
       WHERE dc_number = $1 AND movement_type = 'return'`,
      [
        ticket.return_dc_number,
        nextMeta.dc_dispatch_mode,
        nextMeta.ship_by,
        deliveryPersonId,
        nextMeta.courier_name,
        nextMeta.awb_number,
        nextMeta.porter_tracking_id,
        nextMeta.porter_order_id,
        newDcStatus,
      ]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      isInitialAssign,
      data: {
        return_dc_number: ticket.return_dc_number,
        previous_assignee: previousLabel,
        new_assignee: newLabel,
        dispatch_mode: nextMeta.dispatch_mode,
        reason,
      },
      activity: {
        previousLabel,
        newLabel,
        previousMeta,
        nextMeta,
        reason,
        return_dc_number: ticket.return_dc_number,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  isPickupAssignmentEditable,
  applyReturnPickupAssignment,
};
