/**
 * Procure to stock, step 2 — the "To buy" queue.
 *
 * Two kinds of need, one list:
 *   - laptop shortfalls: a sales order found no matching laptop, so the dispatch
 *     workflow raised a sales_order_procurement_requests row and parked the order
 *     at awaiting_purchase;
 *   - part requests the floor escalated to procurement (part_requests, FLOOR).
 *
 * Each need is linked to the order that fills it (po_id / spo_id). A parked
 * sales order moves on when stock that matches it exists: the queue checks
 * that live, and "Move order on" hands it back to the dispatch workflow.
 * Before this nothing ever called onPurchaseRequestReceived, so every
 * shortfall stayed "New" and its order stayed parked.
 */
const pool = require('../config/db');
const wf = require('./dispatchWorkflowService');

const OPEN_PO = `p.deleted_at IS NULL AND LOWER(COALESCE(p.status, '')) NOT IN ('cancelled', 'rejected', 'completed', 'closed')`;

async function listLaptopShortfalls() {
  const r = await pool.query(
    `SELECT dw.sales_order_number, dw.updated_at AS parked_at,
            pr.id AS request_id, pr.status AS request_status, pr.created_at AS requested_at, pr.linked_at,
            pr.po_id, po.purchase_order_number, po.status AS po_status,
            lu.name AS linked_by_name
       FROM dispatch_workflow dw
       JOIN sales_order_procurement_requests pr ON pr.id = dw.purchase_request_id
       LEFT JOIN vendor_purchase_orders po ON po.po_id = pr.po_id
       LEFT JOIN users lu ON lu.user_id = pr.linked_by
      WHERE dw.status = $1
      ORDER BY dw.updated_at ASC`,
    [wf.STATUS.AWAITING_PR]
  );
  if (!r.rows.length) return [];
  const nums = r.rows.map((x) => x.sales_order_number);
  const lines = await pool.query(
    `SELECT l.id AS line_id, l.sales_order_number, l.customer_name, l.brand, l.model_name, l.processor,
            l.generation, l.ram, l.storage, l.quotation_type, l.created_at,
            COALESCE(l.main_qty, l.quantity, 0)::int AS ordered,
            (SELECT COUNT(*)::int FROM sales_order_serials s
              WHERE s.sales_order_number = l.sales_order_number AND s.line_id = l.id
                AND s.status IN ('attached', 'dispatched')) AS attached
       FROM sales_order_lines l
      WHERE l.sales_order_number = ANY($1::text[])
      ORDER BY l.id`,
    [nums]
  );
  const byOrder = new Map();
  lines.rows.forEach((l) => {
    if (!byOrder.has(l.sales_order_number)) byOrder.set(l.sales_order_number, []);
    byOrder.get(l.sales_order_number).push(l);
  });
  const out = [];
  for (const row of r.rows) {
    const ls = byOrder.get(row.sales_order_number) || [];
    const short = ls.reduce((n, l) => n + Math.max(0, l.ordered - l.attached), 0);
    // Live: is there now a laptop in stock that matches? (read-only check)
    const match = await wf.findAvailableSerialForSo(pool, row.sales_order_number);
    out.push({
      ...row,
      customer_name: ls[0]?.customer_name || null,
      order_type: ls[0]?.quotation_type || null,
      ordered_at: ls[0]?.created_at || null,
      lines: ls.map((l) => ({ ...l, short: Math.max(0, l.ordered - l.attached) })),
      short,
      stock_ready: Boolean(match.available),
      stock_match: match.available ? match.serial.inventory_asset_code || match.serial.serial_number : null,
    });
  }
  return out;
}

async function listPartNeeds() {
  const r = await pool.query(
    `SELECT pr.request_id, pr.request_number, pr.status, pr.quantity, pr.created_at, pr.escalated_at,
            COALESCE(pr.part_name, p.part_name) AS part_name, p.category, p.quantity AS stock_qty,
            pr.spo_id, spo.purchase_order_number AS spo_number, spo.status AS spo_status,
            t.ttspl_id, st.stage_name, u.name AS requester_name, eu.name AS escalated_by_name
       FROM part_requests pr
       LEFT JOIN parts p ON p.part_id = pr.part_id
       LEFT JOIN tickets t ON t.ticket_id = pr.ticket_id
       LEFT JOIN stages st ON st.stage_id = COALESCE(pr.ticket_stage_id, t.current_stage_id)
       LEFT JOIN users u ON u.user_id = pr.requested_by
       LEFT JOIN users eu ON eu.user_id = pr.escalated_by
       LEFT JOIN vendor_spare_parts_purchase_orders spo ON spo.spo_id = pr.spo_id
      WHERE pr.status IN ('escalated', 'ordered') AND COALESCE(pr.context, 'FLOOR') = 'FLOOR'
      ORDER BY COALESCE(pr.escalated_at, pr.created_at) ASC`
  );
  return r.rows;
}

/** Open POs / spare POs to link a need to (newest first). */
async function linkablePurchaseOrders() {
  const [po, spo] = await Promise.all([
    pool.query(
      `SELECT p.po_id, p.purchase_order_number, p.status, p.purchase_order_type,
              COALESCE(NULLIF(TRIM(v.business_name), ''), v.first_name) AS vendor_name
         FROM vendor_purchase_orders p LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
        WHERE ${OPEN_PO} ORDER BY p.po_id DESC LIMIT 200`
    ),
    pool.query(
      `SELECT p.spo_id, p.purchase_order_number, p.status,
              COALESCE(NULLIF(TRIM(v.business_name), ''), v.first_name) AS vendor_name
         FROM vendor_spare_parts_purchase_orders p LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
        WHERE ${OPEN_PO} ORDER BY p.spo_id DESC LIMIT 200`
    ),
  ]);
  return { purchase_orders: po.rows, spare_parts_orders: spo.rows };
}

class ToBuyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** Link a laptop shortfall to the PO that fills it (or clear the link with poId null). */
async function linkLaptopRequest(requestId, poId, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pr = (await client.query(
      `SELECT pr.*, dw.status AS wf_status FROM sales_order_procurement_requests pr
         LEFT JOIN dispatch_workflow dw ON dw.purchase_request_id = pr.id
        WHERE pr.id = $1 FOR UPDATE OF pr`,
      [requestId]
    )).rows[0];
    if (!pr) throw new ToBuyError('Request not found', 404);
    if (pr.wf_status !== wf.STATUS.AWAITING_PR) throw new ToBuyError('This order is no longer waiting for a purchase.');
    let po = null;
    if (poId) {
      po = (await client.query(
        `SELECT p.po_id, p.purchase_order_number FROM vendor_purchase_orders p WHERE p.po_id = $1 AND ${OPEN_PO}`,
        [poId]
      )).rows[0];
      if (!po) throw new ToBuyError('That purchase order is not open (cancelled, rejected or already completed).');
    }
    await client.query(
      `UPDATE sales_order_procurement_requests
          SET po_id = $1, status = $2, linked_by = $3, linked_at = CASE WHEN $1::int IS NULL THEN NULL ELSE NOW() END, updated_at = NOW()
        WHERE id = $4`,
      [po?.po_id || null, po ? 'Ordered' : 'New', user?.user_id || null, requestId]
    );
    await wf.logWorkflowActivity(
      client,
      pr.sales_order_number,
      po ? 'purchase_request_linked' : 'purchase_request_unlinked',
      po ? `Laptops for this order are being bought on ${po.purchase_order_number}.` : 'Purchase order link removed from the purchase request.',
      { purchase_request_id: pr.id, po_id: po?.po_id || null },
      user
    );
    await client.query('COMMIT');
    return { request_id: pr.id, po_id: po?.po_id || null, purchase_order_number: po?.purchase_order_number || null };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Hand a parked order back to the dispatch workflow — only when a matching
 * laptop is in stock now, so it can't bounce straight back and raise a
 * second request.
 */
async function moveOrderOn(salesOrderNumber, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await wf.getWorkflow(client, salesOrderNumber, { forUpdate: true });
    if (!cur) throw new ToBuyError('Order not found', 404);
    if (cur.status !== wf.STATUS.AWAITING_PR) throw new ToBuyError('This order is no longer waiting for a purchase.');
    const match = await wf.findAvailableSerialForSo(client, salesOrderNumber);
    if (!match.available) throw new ToBuyError('No matching laptop is in stock yet.');
    const out = await wf.onPurchaseRequestReceived(client, {
      salesOrderNumber, purchaseRequestId: cur.purchase_request_id, user,
    });
    await client.query('COMMIT');
    return { sales_order_number: salesOrderNumber, status: out?.status, match: match.serial.inventory_asset_code || match.serial.serial_number };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Link a floor part request to the spare-parts PO that buys it. Same effect as
 * PATCH /part-requests/:id/link-spo, but checked against an open SPO and
 * governed by the vendor-management permission matrix instead of a role list.
 */
async function linkPartRequest(requestId, spoId, user) {
  const spo = (await pool.query(
    `SELECT p.spo_id, p.purchase_order_number FROM vendor_spare_parts_purchase_orders p WHERE p.spo_id = $1 AND ${OPEN_PO}`,
    [spoId]
  )).rows[0];
  if (!spo) throw new ToBuyError('That spare-parts order is not open (cancelled, rejected or already completed).');
  const upd = await pool.query(
    `UPDATE part_requests SET status = 'ordered', spo_id = $1, updated_at = NOW()
      WHERE request_id = $2 AND status IN ('escalated', 'ordered') AND COALESCE(context, 'FLOOR') = 'FLOOR'
      RETURNING request_id, request_number`,
    [spo.spo_id, requestId]
  );
  if (!upd.rows.length) throw new ToBuyError('This part request is no longer waiting for procurement.');
  return { ...upd.rows[0], spo_id: spo.spo_id, spo_number: spo.purchase_order_number, by: user?.user_id || null };
}

module.exports = {
  listLaptopShortfalls, listPartNeeds, linkablePurchaseOrders, linkLaptopRequest, linkPartRequest, moveOrderOn, ToBuyError,
};
