const pool = require('../config/db');
const { normalizeDcNumber } = require('../middleware/dcNumberRoutes');

const EDITABLE_STATUSES = new Set(['pending', 'processing', 'in_transit', 'shipped']);

function isAssignmentEditable(status) {
  return EDITABLE_STATUSES.has(String(status || '').toLowerCase());
}

function normalizeDispatchMode(rowOrMode) {
  if (typeof rowOrMode === 'string') {
    const m = String(rowOrMode).toLowerCase();
    if (['inhouse', 'courier', 'porter'].includes(m)) return m;
    return 'courier';
  }
  const row = rowOrMode || {};
  if (row.dispatch_mode) return normalizeDispatchMode(row.dispatch_mode);
  if (row.ship_by === 'by_hand') return 'inhouse';
  if (row.ship_by === 'by_porter') return 'porter';
  if (row.ship_by === 'by_courier') return 'courier';
  return 'courier';
}

function shipByForMode(mode) {
  if (mode === 'inhouse') return 'by_hand';
  if (mode === 'porter') return 'by_porter';
  return 'by_courier';
}

function normalizeDateField(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.trim();
}

function normalizeEstimatedDelivery(v) {
  return normalizeDateField(v);
}

function scheduleFieldsFromBody(body) {
  return {
    estimated_delivery: normalizeDateField(body.estimated_delivery) || null,
    dispatched_at: normalizeDateField(body.dispatched_at ?? body.dispatch_date) || null,
  };
}

function assigneeMetadataFromBody(body, dispatchMode) {
  const schedule = scheduleFieldsFromBody(body);
  if (dispatchMode === 'inhouse') {
    const deliveryPersonId = body.delivery_person_id != null && body.delivery_person_id !== ''
      ? parseInt(body.delivery_person_id, 10)
      : null;
    return {
      dispatch_mode: 'inhouse',
      ship_by: 'by_hand',
      delivery_person_id: Number.isNaN(deliveryPersonId) ? null : deliveryPersonId,
      courier_name: null,
      awb_number: null,
      courier_tracking_url: null,
      porter_booking_id: null,
      porter_tracking_id: null,
      porter_order_id: null,
      porter_booking_url: null,
      ...schedule,
    };
  }
  if (dispatchMode === 'porter') {
    const trackingId = body.porter_tracking_id || body.porter_booking_id || null;
    return {
      dispatch_mode: 'porter',
      ship_by: 'by_porter',
      delivery_person_id: null,
      courier_name: null,
      awb_number: null,
      courier_tracking_url: null,
      porter_booking_id: body.porter_booking_id || trackingId,
      porter_tracking_id: trackingId,
      porter_order_id: body.porter_order_id || null,
      porter_booking_url: body.porter_booking_url || null,
      ...schedule,
    };
  }
  return {
    dispatch_mode: 'courier',
    ship_by: 'by_courier',
    delivery_person_id: null,
    courier_name: body.courier_name || null,
    awb_number: body.awb_number || null,
    courier_tracking_url: body.courier_tracking_url || null,
    porter_booking_id: null,
    porter_tracking_id: null,
    porter_order_id: null,
    porter_booking_url: null,
    ...schedule,
  };
}

function assigneeMetadataFromRow(row) {
  return assigneeMetadataFromBody({
    delivery_person_id: row.delivery_person_id,
    courier_name: row.courier_name,
    awb_number: row.awb_number,
    courier_tracking_url: row.courier_tracking_url,
    porter_booking_id: row.porter_booking_id,
    porter_tracking_id: row.porter_tracking_id,
    porter_order_id: row.porter_order_id,
    porter_booking_url: row.porter_booking_url,
    estimated_delivery: row.estimated_delivery,
    dispatched_at: row.dispatched_at,
  }, normalizeDispatchMode(row));
}

async function resolveTechnicianId(client, rawId) {
  if (rawId == null || rawId === '') return null;
  const id = parseInt(rawId, 10);
  if (Number.isNaN(id)) return null;
  const db = client || pool;
  const byTech = await db.query(
    `SELECT technician_id FROM delivery_technicians WHERE technician_id = $1 AND is_active = TRUE`,
    [id]
  );
  if (byTech.rows.length) return id;
  const byUser = await db.query(
    `SELECT technician_id FROM delivery_technicians WHERE user_id = $1 AND is_active = TRUE LIMIT 1`,
    [id]
  );
  return byUser.rows[0]?.technician_id || id;
}

async function assigneeLabel(client, meta, headRow = {}) {
  const db = client || pool;
  if (meta.dispatch_mode === 'inhouse') {
    const tid = meta.delivery_person_id;
    if (!tid) return 'Unassigned technician';
    if (headRow.delivery_person_name && String(headRow.delivery_person_id) === String(tid)) {
      return headRow.delivery_person_name;
    }
    const r = await db.query(
      `SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || COALESCE(last_name, '')), ''), email, phone) AS name
         FROM delivery_technicians WHERE technician_id = $1`,
      [tid]
    );
    return r.rows[0]?.name || `Technician #${tid}`;
  }
  if (meta.dispatch_mode === 'porter') {
    const parts = [meta.porter_tracking_id, meta.porter_order_id, meta.porter_booking_id].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Porter (unassigned)';
  }
  const parts = [meta.courier_name, meta.awb_number].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Courier (unassigned)';
}

function validateAssignmentPayload(body, dispatchMode) {
  if (!['courier', 'porter', 'inhouse'].includes(dispatchMode)) {
    return 'Invalid dispatch_mode';
  }
  if (dispatchMode === 'inhouse') {
    if (!body.delivery_person_id) return 'Select a delivery technician';
    return null;
  }
  if (dispatchMode === 'courier') {
    if (!String(body.courier_name || '').trim()) return 'Courier name is required';
    if (!String(body.awb_number || '').trim()) return 'AWB number is required';
    return null;
  }
  const porterId = body.porter_tracking_id || body.porter_booking_id;
  if (!String(porterId || '').trim()) return 'Porter booking / tracking ID is required';
  return null;
}

function metadataEqual(a, b) {
  const keys = [
    'dispatch_mode', 'delivery_person_id', 'courier_name', 'awb_number',
    'courier_tracking_url', 'porter_booking_id', 'porter_tracking_id',
    'porter_order_id', 'porter_booking_url', 'estimated_delivery', 'dispatched_at',
  ];
  return keys.every((k) => {
    if (k === 'estimated_delivery' || k === 'dispatched_at') {
      return normalizeDateField(a[k]) === normalizeDateField(b[k]);
    }
    return String(a[k] ?? '') === String(b[k] ?? '');
  });
}

function formatAssignmentActivityDescription(
  dcNumber,
  previousLabel,
  newLabel,
  previousMeta,
  nextMeta,
  reason
) {
  const parts = [`Assignee updated for ${dcNumber}`];
  if (previousLabel !== newLabel) {
    parts.push(`${previousLabel} → ${newLabel}`);
  } else {
    parts.push(newLabel);
  }
  const prevEst = normalizeDateField(previousMeta.estimated_delivery);
  const nextEst = normalizeDateField(nextMeta.estimated_delivery);
  if (prevEst !== nextEst) {
    parts.push(`Est. delivery ${prevEst || '—'} → ${nextEst || '—'}`);
  }
  const prevDispatch = normalizeDateField(previousMeta.dispatched_at);
  const nextDispatch = normalizeDateField(nextMeta.dispatched_at);
  if (prevDispatch !== nextDispatch) {
    parts.push(`Dispatch date ${prevDispatch || '—'} → ${nextDispatch || '—'}`);
  }
  if (previousMeta.dispatch_mode !== nextMeta.dispatch_mode) {
    parts.push(`Mode ${previousMeta.dispatch_mode} → ${nextMeta.dispatch_mode}`);
  }
  if (reason) parts.push(`Reason: ${reason}`);
  return parts.join(' · ');
}

async function listAssignmentHistory(dcNumber, limit = 30) {
  const r = await pool.query(
    `SELECT id, dc_number, sales_order_number, previous_dispatch_mode, new_dispatch_mode,
            previous_assignee_label, new_assignee_label, reason,
            changed_by, changed_by_name, changed_at
       FROM dc_assignment_history
      WHERE dc_number = $1
      ORDER BY changed_at DESC, id DESC
      LIMIT $2`,
    [dcNumber, Math.min(Math.max(limit, 1), 100)]
  );
  return r.rows;
}

async function updateDcAssignment({ dcNumber, body, user }) {
  const resolvedDcNumber = normalizeDcNumber(dcNumber);
  if (!resolvedDcNumber) {
    return { ok: false, status: 400, message: 'Delivery challan number is required' };
  }

  const dispatchMode = normalizeDispatchMode(body.dispatch_mode);
  const validationError = validateAssignmentPayload(body, dispatchMode);
  if (validationError) {
    return { ok: false, status: 400, message: validationError };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query(
      `SELECT DISTINCT ON (dc_number) dcl.*,
              COALESCE(NULLIF(TRIM(dt.first_name || ' ' || COALESCE(dt.last_name, '')), ''), u.name) AS delivery_person_name
         FROM delivery_challan_lines dcl
         LEFT JOIN delivery_technicians dt ON dt.technician_id = dcl.delivery_person_id
         LEFT JOIN users u ON u.user_id = COALESCE(dt.user_id, dcl.delivery_person_id)
        WHERE dcl.dc_number = $1
        LIMIT 1`,
      [resolvedDcNumber]
    );
    if (!cur.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, message: 'Delivery challan not found' };
    }
    const head = cur.rows[0];

    const statusRows = await client.query(
      `SELECT DISTINCT status FROM delivery_challan_lines WHERE dc_number = $1`,
      [resolvedDcNumber]
    );
    const statuses = statusRows.rows.map((r) => String(r.status || '').toLowerCase());
    if (statuses.some((s) => !isAssignmentEditable(s))) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        message: 'Assignee cannot be changed after pickup/delivery has started.',
      };
    }

    const previousMeta = assigneeMetadataFromRow(head);
    const nextMeta = assigneeMetadataFromBody(body, dispatchMode);
    if (nextMeta.dispatch_mode === 'inhouse') {
      nextMeta.delivery_person_id = await resolveTechnicianId(client, nextMeta.delivery_person_id);
    }
    if (previousMeta.dispatch_mode === 'inhouse') {
      previousMeta.delivery_person_id = await resolveTechnicianId(client, previousMeta.delivery_person_id);
    }

    const reason = body.reason != null ? String(body.reason).trim() || null : null;

    if (metadataEqual(previousMeta, nextMeta) && !reason) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, message: 'No assignment changes detected' };
    }

    const previousLabel = await assigneeLabel(client, previousMeta, head);
    const newLabel = await assigneeLabel(client, nextMeta, head);

    await client.query(
      `UPDATE delivery_challan_lines SET
          dispatch_mode = $1,
          ship_by = $2,
          delivery_person_id = $3,
          courier_name = $4,
          awb_number = $5,
          courier_tracking_url = $6,
          porter_booking_id = $7,
          porter_tracking_id = $8,
          porter_order_id = $9,
          porter_booking_url = $10,
          estimated_delivery = $11,
          dispatched_at = $12,
          pdf_path = NULL,
          updated_at = NOW()
       WHERE dc_number = $13`,
      [
        nextMeta.dispatch_mode,
        nextMeta.ship_by,
        nextMeta.delivery_person_id,
        nextMeta.courier_name,
        nextMeta.awb_number,
        nextMeta.courier_tracking_url,
        nextMeta.porter_booking_id,
        nextMeta.porter_tracking_id,
        nextMeta.porter_order_id,
        nextMeta.porter_booking_url,
        nextMeta.estimated_delivery,
        nextMeta.dispatched_at,
        resolvedDcNumber,
      ]
    );

    await client.query(
      `INSERT INTO dc_assignment_history (
         dc_number, sales_order_number,
         previous_dispatch_mode, new_dispatch_mode,
         previous_assignee_label, new_assignee_label,
         previous_metadata, new_metadata, reason,
         changed_by, changed_by_name
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
      [
        resolvedDcNumber,
        head.sales_order_number || null,
        previousMeta.dispatch_mode,
        nextMeta.dispatch_mode,
        previousLabel,
        newLabel,
        JSON.stringify(previousMeta),
        JSON.stringify(nextMeta),
        reason,
        user?.user_id || null,
        user?.name || null,
      ]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      data: {
        dc_number: resolvedDcNumber,
        previous_assignee: previousLabel,
        new_assignee: newLabel,
        dispatch_mode: nextMeta.dispatch_mode,
        reason,
      },
      sales_order_number: head.sales_order_number,
      activity: {
        description: formatAssignmentActivityDescription(
          resolvedDcNumber,
          previousLabel,
          newLabel,
          previousMeta,
          nextMeta,
          reason
        ),
        previousLabel,
        newLabel,
        previousMeta,
        nextMeta,
        reason,
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
  EDITABLE_STATUSES,
  isAssignmentEditable,
  normalizeDispatchMode,
  shipByForMode,
  listAssignmentHistory,
  updateDcAssignment,
  resolveTechnicianId,
};
