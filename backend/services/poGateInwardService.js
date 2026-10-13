/**
 * Guard gate inward against a vendor Purchase Order — D4/D7.
 *
 * One record: vendor_deliveries (334) with the guard's count per PO line in
 * vendor_delivery_lines (413). Production's po_gate_inwards (276) was the same
 * idea; 413 copies its rows here. "Inward" and "delivery" name the same row:
 * inward_id = delivery_id, inward_number = delivery_number.
 *
 * Flow: the guard counts the laptops that arrived, line by line (e.g. 2 of 10)
 * → a vendor_deliveries row. The warehouse receives serials against it; the
 * first receipt creates the delivery's own GRN, so each delivery is a separate
 * GRN on the same PO. Units received per line are counted from
 * vendor_serial_numbers (grn_id + extra.line_index), rejected-at-door included
 * — the guard counted those too.
 *
 * A delivery logged before 413 has no lines: its laptop_count caps the whole
 * delivery, on any line.
 */
const pool = require('../config/db');
const {
  ACTIVITY_TYPES,
  safeLogPurchaseOrderActivity,
} = require('./purchaseOrderActivityService');
const { logVendorAudit } = require('./vendorAuditLogService');

/** PO statuses on which the guard may inward and the warehouse may receive. */
const INWARD_OPEN_PO_STATUSES = ['approved', 'vendor_accepted', 'sent', 'processing'];
const OPEN_DELIVERY_STATUSES = ['arrived', 'receiving'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Lazy: the PO controller requires this service at load time.
function poHelpers() {
  // eslint-disable-next-line global-require
  return require('../controllers/vendorManagement/purchaseOrders.controller').receiveQtyHelpers;
}

function lineLabel(line) {
  const title = [line.brand || line.brand_name, line.model || line.model_name].filter(Boolean).join(' ');
  const specs = [line.processor, line.generation, line.ram, line.storage]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).trim());
  return [title || 'Item', specs.join(' | ')].filter(Boolean).join(' — ');
}

/**
 * The old Receive goods / PO Inward screens speak 276's status words.
 * A delivery closed short (fewer handled than logged) reads as 'closed'.
 */
function inwardStatus(d, handled) {
  if (d.status === 'arrived') return 'pending_grn';
  if (d.status === 'receiving') return 'partially_received';
  if (d.status === 'received') return handled >= Number(d.laptop_count) ? 'received' : 'closed';
  return 'closed';
}

/** Units received on each (delivery, line) — keyed `${delivery_id}:${line_index}`. */
async function receivedByDeliveryLine(db, deliveryIds) {
  const out = new Map();
  if (!deliveryIds.length) return out;
  const { rows } = await db.query(
    `SELECT d.delivery_id, COALESCE(NULLIF(vsn.extra->>'line_index', '')::int, 0) AS line_index, COUNT(*)::int AS n
       FROM vendor_deliveries d
       JOIN vendor_serial_numbers vsn ON vsn.grn_id = d.grn_id AND vsn.deleted_at IS NULL
      WHERE d.delivery_id = ANY($1::int[])
        AND d.grn_id IS NOT NULL
        AND COALESCE(vsn.extra->>'line_index', '0') ~ '^[0-9]+$'
      GROUP BY 1, 2`,
    [deliveryIds]
  );
  rows.forEach((r) => out.set(`${r.delivery_id}:${r.line_index}`, r.n));
  return out;
}

function sumFor(received, deliveryId) {
  let n = 0;
  received.forEach((v, k) => { if (k.startsWith(`${deliveryId}:`)) n += v; });
  return n;
}

/** Deliveries on a PO with per-line qty / received / remaining. */
async function listInwardsForPo(db, poId) {
  const { rows: deliveries } = await db.query(
    `SELECT d.*, 'GRN-' || LPAD(d.grn_id::text, 4, '0') AS grn_number, lu.name AS logged_by_name
       FROM vendor_deliveries d
       LEFT JOIN users lu ON lu.user_id = d.logged_by
      WHERE d.po_id = $1
      ORDER BY d.delivery_id DESC`,
    [poId]
  );
  if (!deliveries.length) return [];
  const ids = deliveries.map((d) => d.delivery_id);
  const { rows: lines } = await db.query(
    `SELECT delivery_id, line_index, qty, line_label
       FROM vendor_delivery_lines WHERE delivery_id = ANY($1::int[])
      ORDER BY line_index`,
    [ids]
  );
  const received = await receivedByDeliveryLine(db, ids);
  return deliveries.map((d) => {
    const open = OPEN_DELIVERY_STATUSES.includes(d.status);
    const myLines = lines
      .filter((l) => l.delivery_id === d.delivery_id)
      .map((l) => {
        const got = received.get(`${d.delivery_id}:${l.line_index}`) || 0;
        return {
          line_index: l.line_index,
          line_label: l.line_label,
          qty: l.qty,
          received: got,
          remaining: open ? Math.max(0, l.qty - got) : 0,
        };
      });
    const receivedQty = sumFor(received, d.delivery_id);
    return {
      inward_id: d.delivery_id,
      inward_number: d.delivery_number,
      delivery_id: d.delivery_id,
      delivery_number: d.delivery_number,
      po_id: d.po_id,
      grn_id: d.grn_id,
      grn_number: d.grn_id ? d.grn_number : null,
      status: inwardStatus(d, receivedQty),
      delivery_status: d.status,
      total_qty: d.laptop_count,
      received_qty: receivedQty,
      remaining_qty: open ? Math.max(0, Number(d.laptop_count) - receivedQty) : 0,
      vendor_doc_number: d.vendor_challan_no,
      vendor_invoice_no: d.vendor_invoice_no,
      vehicle_number: d.vehicle_no,
      remarks: d.notes,
      guard_user_id: d.logged_by,
      guard_name: d.logged_by_name,
      created_at: d.arrived_at,
      closed_at: d.completed_at,
      close_reason: d.completion_note,
      lines: myLines,
    };
  });
}

/**
 * PO lines for the guard: ordered, already received, waiting at the gate for a
 * GRN, and how many more may still be inwarded. No prices are returned.
 */
async function buildInwardAvailability(db, po) {
  const { buildReceivedQtyMapsForPoIds, enrichLineItemsWithReceived, parseLineItemsJson } = poHelpers();
  const qtyMaps = await buildReceivedQtyMapsForPoIds([po.po_id]);
  const lines = enrichLineItemsWithReceived(parseLineItemsJson(po.line_items), qtyMaps.get(Number(po.po_id)));
  const inwards = await listInwardsForPo(db, po.po_id);
  const pendingByLine = {};
  inwards.forEach((inw) => inw.lines.forEach((l) => {
    pendingByLine[l.line_index] = (pendingByLine[l.line_index] || 0) + l.remaining;
  }));
  const outLines = lines.map((line, idx) => {
    const ordered = Number(line.quantity) || 0;
    const receivedQty = Number(line.receivedQty) || 0;
    const pending = pendingByLine[idx] || 0;
    return {
      line_index: idx,
      label: lineLabel(line),
      brand: line.brand || line.brand_name || null,
      model: line.model || line.model_name || null,
      processor: line.processor || null,
      generation: line.generation || null,
      ram: line.ram || null,
      storage: line.storage || null,
      ordered,
      received: receivedQty,
      pending_grn: pending,
      available_to_inward: Math.max(0, ordered - receivedQty - pending),
    };
  });
  return { lines: outLines, inwards };
}

async function loadPoForInward(db, { poId = null, poNumber = null, lock = false } = {}) {
  const params = [];
  let where;
  if (poId) {
    params.push(Number(poId));
    where = 'p.po_id = $1';
  } else {
    const raw = String(poNumber || '').trim().toUpperCase();
    if (!raw) throw httpError(400, 'Enter a PO number');
    // Accept "PO-0237", "po0237" or just "237".
    const digits = raw.replace(/^PO-?/, '');
    params.push(raw, /^[0-9]+$/.test(digits) ? `PO-${digits.padStart(4, '0')}` : raw);
    where = '(UPPER(p.purchase_order_number) = $1 OR UPPER(p.purchase_order_number) = $2)';
  }
  const { rows } = await db.query(
    `SELECT p.po_id, p.purchase_order_number, p.purchase_order_date, p.purchase_order_type,
            p.status, p.line_items, p.vendor_id, p.expected_delivery_date,
            COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_name
       FROM vendor_purchase_orders p
       LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
      WHERE ${where} AND p.deleted_at IS NULL
      LIMIT 1
      ${lock ? 'FOR UPDATE OF p' : ''}`,
    params
  );
  if (!rows.length) throw httpError(404, 'Purchase order not found');
  return rows[0];
}

function poInwardBlockReason(po) {
  const st = String(po.status || '').toLowerCase();
  if (st === 'completed') return 'This purchase order is already fully received.';
  if (!INWARD_OPEN_PO_STATUSES.includes(st)) {
    return `This purchase order is "${st.replace(/_/g, ' ') || 'draft'}". Laptops can be inwarded only after the PO is approved. Call procurement before letting the delivery in.`;
  }
  return null;
}

/** Guard lookup by PO number (old screen) or id (Carret). */
async function lookupPo({ poNumber = null, poId = null } = {}) {
  const po = await loadPoForInward(pool, { poNumber, poId });
  const { lines, inwards } = await buildInwardAvailability(pool, po);
  return {
    po_id: po.po_id,
    purchase_order_number: po.purchase_order_number,
    purchase_order_date: po.purchase_order_date,
    purchase_order_type: po.purchase_order_type,
    expected_delivery_date: po.expected_delivery_date,
    status: po.status,
    vendor_name: po.vendor_name,
    blocked_reason: poInwardBlockReason(po),
    lines,
    inwards,
  };
}

/** The guard logs laptops that arrived against a PO, counted per line. */
async function createInward({
  poId, lines, vendorDocNumber, vendorInvoiceNo, carrierName, vehicleNumber, remarks, user,
}) {
  const wanted = (Array.isArray(lines) ? lines : [])
    .map((l) => ({ line_index: Number(l.line_index), qty: Number(l.qty) }))
    .filter((l) => Number.isInteger(l.line_index) && l.line_index >= 0 && Number.isInteger(l.qty) && l.qty > 0);
  if (!wanted.length) throw httpError(400, 'Enter the number of laptops that arrived for at least one line');
  if (new Set(wanted.map((l) => l.line_index)).size !== wanted.length) {
    throw httpError(400, 'Each PO line can appear only once');
  }
  const challan = String(vendorDocNumber || '').trim().slice(0, 100);
  if (!challan) throw httpError(400, "Enter the vendor's challan or delivery note number");

  const client = await pool.connect();
  let po;
  let row;
  let total;
  try {
    await client.query('BEGIN');
    // Lock the PO so two guards cannot over-inward the same line at once.
    po = await loadPoForInward(client, { poId, lock: true });
    const blocked = poInwardBlockReason(po);
    if (blocked) throw httpError(409, blocked);

    const { lines: avail } = await buildInwardAvailability(client, po);
    for (const w of wanted) {
      const line = avail[w.line_index];
      if (!line) throw httpError(400, `Line ${w.line_index + 1} does not exist on this PO`);
      if (w.qty > line.available_to_inward) {
        throw httpError(
          400,
          `Line ${w.line_index + 1} (${line.label}): only ${line.available_to_inward} more laptop(s) can be inwarded`
          + ` — ordered ${line.ordered}, received ${line.received}, waiting for GRN ${line.pending_grn}.`
        );
      }
    }

    total = wanted.reduce((s, l) => s + l.qty, 0);
    const ins = await client.query(
      `INSERT INTO vendor_deliveries (po_id, vendor_id, vendor_challan_no, vendor_invoice_no, laptop_count, carrier_name, vehicle_no, notes, logged_by)
       VALUES ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), $9) RETURNING delivery_id`,
      [
        po.po_id, po.vendor_id, challan,
        String(vendorInvoiceNo || '').trim().slice(0, 100),
        total,
        String(carrierName || '').trim().slice(0, 255),
        String(vehicleNumber || '').trim().slice(0, 50),
        String(remarks || '').trim().slice(0, 2000),
        user?.user_id || null,
      ]
    );
    const id = ins.rows[0].delivery_id;
    row = (await client.query(
      "UPDATE vendor_deliveries SET delivery_number = 'VD-' || LPAD($1::text, 6, '0') WHERE delivery_id = $1 RETURNING *",
      [id]
    )).rows[0];
    for (const w of wanted) {
      await client.query(
        'INSERT INTO vendor_delivery_lines (delivery_id, line_index, qty, line_label) VALUES ($1, $2, $3, $4)',
        [id, w.line_index, w.qty, avail[w.line_index].label]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  await logVendorAudit({
    actorUserId: user?.user_id, vendorId: po.vendor_id, entityType: 'vendor_delivery', entityId: String(row.delivery_id),
    action: 'arrived', payload: { po_id: po.po_id, laptop_count: total, lines: wanted, vendor_challan_no: challan },
  });
  await safeLogPurchaseOrderActivity({
    poId: po.po_id,
    activityType: ACTIVITY_TYPES.GRN,
    action: 'gate_inward',
    description: `Guard logged ${total} laptop(s) at the gate against ${po.purchase_order_number} (${row.delivery_number}).`,
    metadata: { delivery_id: row.delivery_id, delivery_number: row.delivery_number, lines: wanted, vendor_challan_no: challan },
    user,
  });

  const [created] = (await listInwardsForPo(pool, po.po_id)).filter((i) => i.inward_id === row.delivery_id);
  return { ...row, ...created, purchase_order_number: po.purchase_order_number };
}

/** Recent deliveries for the guard screen. */
async function listRecentInwards({ limit = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT d.delivery_id AS inward_id, d.delivery_number AS inward_number, d.po_id, p.purchase_order_number,
            d.laptop_count AS total_qty, d.status AS delivery_status, d.vendor_challan_no AS vendor_doc_number,
            lu.name AS guard_name, d.arrived_at AS created_at, d.grn_id,
            CASE WHEN d.grn_id IS NULL THEN NULL ELSE 'GRN-' || LPAD(d.grn_id::text, 4, '0') END AS grn_number,
            COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_name
       FROM vendor_deliveries d
       JOIN vendor_purchase_orders p ON p.po_id = d.po_id
       LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
       LEFT JOIN users lu ON lu.user_id = d.logged_by
      ORDER BY d.delivery_id DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 30, 1), 200)]
  );
  const received = await receivedByDeliveryLine(pool, rows.map((r) => r.inward_id));
  return rows.map((r) => ({
    ...r,
    status: inwardStatus({ status: r.delivery_status, laptop_count: r.total_qty }, sumFor(received, r.inward_id)),
  }));
}

/**
 * Close a delivery: nothing more will be received on it. With nothing
 * received this turns it away (cancelled); otherwise it is received, and the
 * reason records the difference from the guard's count.
 */
async function closeInward({ poId, inwardId, reason, user }) {
  const why = String(reason || '').trim();
  if (!why) throw httpError(400, 'Enter a reason for closing this inward');
  const client = await pool.connect();
  let d;
  let next;
  let handled;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM vendor_deliveries WHERE delivery_id = $1 AND po_id = $2 FOR UPDATE',
      [inwardId, poId]
    );
    if (!rows.length) throw httpError(404, 'Gate inward not found');
    d = rows[0];
    if (!OPEN_DELIVERY_STATUSES.includes(d.status)) throw httpError(409, `${d.delivery_number} is already ${d.status}.`);
    handled = sumFor(await receivedByDeliveryLine(client, [d.delivery_id]), d.delivery_id);
    next = handled === 0 ? 'cancelled' : 'received';
    await client.query(
      `UPDATE vendor_deliveries SET status = $2, completed_at = NOW(), completed_by = $3,
              completion_note = $4, updated_at = NOW()
        WHERE delivery_id = $1`,
      [d.delivery_id, next, user?.user_id || null, why.slice(0, 2000)]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await logVendorAudit({
    actorUserId: user?.user_id, vendorId: d.vendor_id, entityType: 'vendor_delivery', entityId: String(d.delivery_id),
    action: next === 'cancelled' ? 'turned_away' : 'receiving_complete',
    payload: { logged: d.laptop_count, handled, note: why },
  });
  await safeLogPurchaseOrderActivity({
    poId,
    activityType: ACTIVITY_TYPES.GRN,
    action: 'gate_inward_closed',
    description: `Gate inward ${d.delivery_number} closed: ${why}`,
    metadata: { delivery_id: d.delivery_id, delivery_number: d.delivery_number },
    user,
  });
}

/**
 * Inside the caller's receive transaction: lock the delivery, check that `qty`
 * more units fit on `lineIndex`, and return the delivery's GRN (created on the
 * first receipt, carrying the vendor's challan and invoice). Throws httpError
 * on any mismatch.
 */
async function claimInwardForReceive(client, { poId, inwardId, lineIndex, qty = 1 }) {
  if (!inwardId) {
    throw httpError(
      400,
      'Select the gate entry for these laptops. The guard must log them against this PO at the gate before the GRN.'
    );
  }
  const { rows } = await client.query('SELECT * FROM vendor_deliveries WHERE delivery_id = $1 FOR UPDATE', [inwardId]);
  const d = rows[0];
  if (!d || Number(d.po_id) !== Number(poId)) throw httpError(400, 'That gate entry is not for this purchase order.');
  if (!OPEN_DELIVERY_STATUSES.includes(d.status)) {
    throw httpError(409, `${d.delivery_number} is already ${d.status}; nothing more can be received on it.`);
  }
  const received = await receivedByDeliveryLine(client, [d.delivery_id]);
  const lineRows = (await client.query(
    'SELECT line_index, qty FROM vendor_delivery_lines WHERE delivery_id = $1', [d.delivery_id]
  )).rows;
  if (lineRows.length) {
    const line = lineRows.find((l) => Number(l.line_index) === Number(lineIndex));
    if (!line) throw httpError(400, `${d.delivery_number} has no laptops for product ${Number(lineIndex) + 1}.`);
    const left = line.qty - (received.get(`${d.delivery_id}:${lineIndex}`) || 0);
    if (qty > left) {
      throw httpError(409, `${d.delivery_number} has only ${Math.max(0, left)} laptop(s) left to receive on product ${Number(lineIndex) + 1}.`);
    }
  } else {
    // Logged before per-line counts: the guard's total caps the delivery.
    const onIt = sumFor(received, d.delivery_id);
    if (onIt + qty > Number(d.laptop_count)) {
      throw httpError(409, `The guard logged ${d.laptop_count} laptop(s) on ${d.delivery_number}, and ${onIt} are already received. Ask the guard to correct the count if more arrived.`);
    }
  }

  let grnId = d.grn_id;
  let grnWasNew = false;
  if (!grnId) {
    const g = await client.query(
      `INSERT INTO vendor_goods_received_notes (po_id, meta, delivery_id, vendor_challan_no, vendor_invoice_no, bill_name)
       VALUES ($1, $2::jsonb, $3, $4, $5, $5) RETURNING grn_id`,
      [poId, JSON.stringify({ delivery_number: d.delivery_number }), d.delivery_id, d.vendor_challan_no, d.vendor_invoice_no]
    );
    grnId = g.rows[0].grn_id;
    grnWasNew = true;
  }
  if (grnWasNew || d.status === 'arrived') {
    await client.query(
      "UPDATE vendor_deliveries SET grn_id = $1, status = 'receiving', updated_at = NOW() WHERE delivery_id = $2",
      [grnId, d.delivery_id]
    );
  }
  return { grnId, grnWasNew, inward: d };
}

/**
 * After serials are inserted (same transaction): once everything the guard
 * counted is handled, the delivery is received.
 */
async function refreshInwardStatus(client, inwardId) {
  if (!inwardId) return;
  const { rows } = await client.query('SELECT delivery_id, laptop_count, status FROM vendor_deliveries WHERE delivery_id = $1', [inwardId]);
  const d = rows[0];
  if (!d || !OPEN_DELIVERY_STATUSES.includes(d.status)) return;
  const handled = sumFor(await receivedByDeliveryLine(client, [d.delivery_id]), d.delivery_id);
  if (handled >= Number(d.laptop_count)) {
    await client.query(
      "UPDATE vendor_deliveries SET status = 'received', completed_at = NOW(), updated_at = NOW() WHERE delivery_id = $1",
      [d.delivery_id]
    );
  }
}

module.exports = {
  INWARD_OPEN_PO_STATUSES,
  lookupPo,
  createInward,
  listInwardsForPo,
  listRecentInwards,
  closeInward,
  claimInwardForReceive,
  refreshInwardStatus,
};
