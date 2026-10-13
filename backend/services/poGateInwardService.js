/**
 * Guard gate inward against a vendor Purchase Order (migration 276).
 *
 * Flow: the guard counts the laptops that arrived against a PO line by line
 * (e.g. 2 of 10) → a po_gate_inwards row. Warehouse then receives serials
 * against that inward; the first receipt creates the inward's own GRN, so each
 * delivery becomes a separate GRN on the same PO. Units received per inward are
 * counted from vendor_serial_numbers (grn_id + extra.line_index).
 */
const pool = require('../config/db');
const {
  ACTIVITY_TYPES,
  safeLogPurchaseOrderActivity,
} = require('./purchaseOrderActivityService');

/** PO statuses on which the guard may inward and the warehouse may receive. */
const INWARD_OPEN_PO_STATUSES = ['approved', 'vendor_accepted', 'sent', 'processing'];
const OPEN_INWARD_STATUSES = ['pending_grn', 'partially_received'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function formatInwardNumber(id) {
  return `PGI-${String(id).padStart(6, '0')}`;
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

/** Units received on each (inward, line) — keyed `${inward_id}:${line_index}`. */
async function receivedByInwardLine(db, inwardIds) {
  const out = new Map();
  if (!inwardIds.length) return out;
  const { rows } = await db.query(
    `SELECT gi.inward_id, (vsn.extra->>'line_index')::int AS line_index, COUNT(*)::int AS n
       FROM po_gate_inwards gi
       JOIN vendor_serial_numbers vsn
         ON vsn.grn_id = gi.grn_id AND vsn.deleted_at IS NULL
      WHERE gi.inward_id = ANY($1::int[])
        AND gi.grn_id IS NOT NULL
        AND COALESCE(vsn.extra->>'line_index', '') ~ '^[0-9]+$'
      GROUP BY 1, 2`,
    [inwardIds]
  );
  rows.forEach((r) => out.set(`${r.inward_id}:${r.line_index}`, r.n));
  return out;
}

/** Inwards on a PO with per-line qty / received / remaining. */
async function listInwardsForPo(db, poId) {
  const { rows: inwards } = await db.query(
    `SELECT gi.*, 'GRN-' || LPAD(gi.grn_id::text, 4, '0') AS grn_number
       FROM po_gate_inwards gi
      WHERE gi.po_id = $1
      ORDER BY gi.inward_id DESC`,
    [poId]
  );
  if (!inwards.length) return [];
  const ids = inwards.map((i) => i.inward_id);
  const { rows: lines } = await db.query(
    `SELECT inward_id, line_index, qty, line_label
       FROM po_gate_inward_lines WHERE inward_id = ANY($1::int[])
      ORDER BY line_index`,
    [ids]
  );
  const received = await receivedByInwardLine(db, ids);
  return inwards.map((inw) => {
    const myLines = lines
      .filter((l) => l.inward_id === inw.inward_id)
      .map((l) => {
        const got = received.get(`${inw.inward_id}:${l.line_index}`) || 0;
        const open = OPEN_INWARD_STATUSES.includes(inw.status);
        return {
          line_index: l.line_index,
          line_label: l.line_label,
          qty: l.qty,
          received: got,
          remaining: open ? Math.max(0, l.qty - got) : 0,
        };
      });
    const receivedQty = myLines.reduce((s, l) => s + l.received, 0);
    return {
      inward_id: inw.inward_id,
      inward_number: inw.inward_number,
      po_id: inw.po_id,
      grn_id: inw.grn_id,
      grn_number: inw.grn_id ? inw.grn_number : null,
      status: inw.status,
      total_qty: inw.total_qty,
      received_qty: receivedQty,
      remaining_qty: myLines.reduce((s, l) => s + l.remaining, 0),
      vendor_doc_number: inw.vendor_doc_number,
      vehicle_number: inw.vehicle_number,
      remarks: inw.remarks,
      guard_user_id: inw.guard_user_id,
      guard_name: inw.guard_name,
      created_at: inw.created_at,
      closed_at: inw.closed_at,
      close_reason: inw.close_reason,
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
            p.status, p.line_items, p.vendor_id,
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
    return `This purchase order is "${st.replace(/_/g, ' ') || 'draft'}". Laptops can be inwarded only after the PO is approved.`;
  }
  return null;
}

/** Guard lookup by PO number. */
async function lookupPo(poNumber) {
  const po = await loadPoForInward(pool, { poNumber });
  const { lines, inwards } = await buildInwardAvailability(pool, po);
  return {
    po_id: po.po_id,
    purchase_order_number: po.purchase_order_number,
    purchase_order_date: po.purchase_order_date,
    purchase_order_type: po.purchase_order_type,
    status: po.status,
    vendor_name: po.vendor_name,
    blocked_reason: poInwardBlockReason(po),
    lines,
    inwards,
  };
}

/** Guard records laptops that arrived against a PO. */
async function createInward({ poId, lines, vendorDocNumber, vehicleNumber, remarks, user }) {
  const wanted = (Array.isArray(lines) ? lines : [])
    .map((l) => ({ line_index: Number(l.line_index), qty: Number(l.qty) }))
    .filter((l) => Number.isInteger(l.line_index) && l.line_index >= 0 && Number.isInteger(l.qty) && l.qty > 0);
  if (!wanted.length) throw httpError(400, 'Enter the number of laptops received for at least one line');
  if (new Set(wanted.map((l) => l.line_index)).size !== wanted.length) {
    throw httpError(400, 'Each PO line can appear only once');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the PO so two guards cannot over-inward the same line at once.
    const po = await loadPoForInward(client, { poId, lock: true });
    const blocked = poInwardBlockReason(po);
    if (blocked) throw httpError(400, blocked);

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

    const total = wanted.reduce((s, l) => s + l.qty, 0);
    const ins = await client.query(
      `INSERT INTO po_gate_inwards
         (po_id, total_qty, vendor_doc_number, vehicle_number, remarks, guard_user_id, guard_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING inward_id`,
      [
        po.po_id, total,
        String(vendorDocNumber || '').trim().slice(0, 120) || null,
        String(vehicleNumber || '').trim().slice(0, 40) || null,
        String(remarks || '').trim().slice(0, 2000) || null,
        user?.user_id || null,
        user?.name || null,
      ]
    );
    const inwardId = ins.rows[0].inward_id;
    const inwardNumber = formatInwardNumber(inwardId);
    await client.query('UPDATE po_gate_inwards SET inward_number = $1 WHERE inward_id = $2', [inwardNumber, inwardId]);
    for (const w of wanted) {
      await client.query(
        `INSERT INTO po_gate_inward_lines (inward_id, line_index, qty, line_label) VALUES ($1,$2,$3,$4)`,
        [inwardId, w.line_index, w.qty, avail[w.line_index].label]
      );
    }
    await client.query('COMMIT');

    await safeLogPurchaseOrderActivity({
      poId: po.po_id,
      activityType: ACTIVITY_TYPES.GRN,
      action: 'gate_inward',
      description: `Guard inwarded ${total} laptop(s) at the gate against ${po.purchase_order_number} (${inwardNumber}).`,
      metadata: { inward_id: inwardId, inward_number: inwardNumber, lines: wanted, vendor_doc_number: vendorDocNumber || null },
      user,
    });

    const [created] = (await listInwardsForPo(pool, po.po_id)).filter((i) => i.inward_id === inwardId);
    return { ...created, purchase_order_number: po.purchase_order_number };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Recent inwards for the guard screen. */
async function listRecentInwards({ limit = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT gi.inward_id, gi.inward_number, gi.po_id, p.purchase_order_number, gi.total_qty,
            gi.status, gi.vendor_doc_number, gi.guard_name, gi.created_at,
            'GRN-' || LPAD(gi.grn_id::text, 4, '0') AS grn_number,
            COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_name
       FROM po_gate_inwards gi
       JOIN vendor_purchase_orders p ON p.po_id = gi.po_id
       LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
      ORDER BY gi.inward_id DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 30, 1), 200)]
  );
  return rows.map((r) => ({ ...r, grn_number: r.grn_number && r.grn_number !== 'GRN-' ? r.grn_number : null }));
}

/**
 * Close an inward: nothing more will be received on it (laptop short, wrong
 * count). With nothing received yet this is a cancel.
 */
async function closeInward({ poId, inwardId, reason, user }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM po_gate_inwards WHERE inward_id = $1 AND po_id = $2 FOR UPDATE',
      [inwardId, poId]
    );
    if (!rows.length) throw httpError(404, 'Gate inward not found');
    const inw = rows[0];
    if (!OPEN_INWARD_STATUSES.includes(inw.status)) throw httpError(400, `This inward is already ${inw.status.replace(/_/g, ' ')}`);
    const why = String(reason || '').trim();
    if (!why) throw httpError(400, 'Enter a reason for closing this inward');
    await client.query(
      `UPDATE po_gate_inwards SET status = 'closed', closed_at = NOW(), closed_by = $2,
              close_reason = $3, updated_at = NOW()
        WHERE inward_id = $1`,
      [inwardId, user?.user_id || null, why.slice(0, 2000)]
    );
    await client.query('COMMIT');
    await safeLogPurchaseOrderActivity({
      poId,
      activityType: ACTIVITY_TYPES.GRN,
      action: 'gate_inward_closed',
      description: `Gate inward ${inw.inward_number} closed: ${why}`,
      metadata: { inward_id: inwardId, inward_number: inw.inward_number },
      user,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Inside the caller's receive transaction: lock the inward, check that `qty`
 * more units fit on `lineIndex`, and return the inward's GRN (created on the
 * first receipt). Throws httpError on any mismatch.
 */
async function claimInwardForReceive(client, { poId, inwardId, lineIndex, qty = 1 }) {
  if (!inwardId) {
    throw httpError(
      400,
      'Select the guard gate inward for these laptops. The guard must inward them against this PO at the gate before the GRN.'
    );
  }
  const { rows } = await client.query(
    'SELECT * FROM po_gate_inwards WHERE inward_id = $1 FOR UPDATE',
    [inwardId]
  );
  const inw = rows[0];
  if (!inw || Number(inw.po_id) !== Number(poId)) throw httpError(400, 'This gate inward does not belong to this purchase order.');
  if (!OPEN_INWARD_STATUSES.includes(inw.status)) {
    throw httpError(400, `Gate inward ${inw.inward_number} is ${inw.status.replace(/_/g, ' ')}; nothing more can be received on it.`);
  }
  const lineRes = await client.query(
    'SELECT qty FROM po_gate_inward_lines WHERE inward_id = $1 AND line_index = $2',
    [inwardId, lineIndex]
  );
  if (!lineRes.rows.length) {
    throw httpError(400, `Gate inward ${inw.inward_number} has no laptops for product ${Number(lineIndex) + 1}.`);
  }
  const got = (await receivedByInwardLine(client, [inwardId])).get(`${inwardId}:${lineIndex}`) || 0;
  const left = lineRes.rows[0].qty - got;
  if (qty > left) {
    throw httpError(
      400,
      `Gate inward ${inw.inward_number} has only ${Math.max(0, left)} laptop(s) left to receive on product ${Number(lineIndex) + 1}.`
    );
  }

  let grnId = inw.grn_id;
  let grnWasNew = false;
  if (!grnId) {
    const g = await client.query(
      `INSERT INTO vendor_goods_received_notes (po_id, meta) VALUES ($1, $2::jsonb) RETURNING grn_id`,
      [poId, JSON.stringify({ gate_inward_id: inw.inward_id, gate_inward_number: inw.inward_number })]
    );
    grnId = g.rows[0].grn_id;
    grnWasNew = true;
    await client.query('UPDATE po_gate_inwards SET grn_id = $1, updated_at = NOW() WHERE inward_id = $2', [grnId, inwardId]);
  }
  return { grnId, grnWasNew, inward: inw };
}

/** After serials are inserted (same transaction): move the inward's status on. */
async function refreshInwardStatus(client, inwardId) {
  const { rows } = await client.query(
    'SELECT inward_id, total_qty, status FROM po_gate_inwards WHERE inward_id = $1',
    [inwardId]
  );
  const inw = rows[0];
  if (!inw || !OPEN_INWARD_STATUSES.includes(inw.status)) return;
  const received = [...(await receivedByInwardLine(client, [inwardId])).values()].reduce((s, n) => s + n, 0);
  const next = received >= inw.total_qty ? 'received' : received > 0 ? 'partially_received' : 'pending_grn';
  if (next !== inw.status) {
    await client.query('UPDATE po_gate_inwards SET status = $1, updated_at = NOW() WHERE inward_id = $2', [next, inwardId]);
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
