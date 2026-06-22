const { query, body, param, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { multerLimits } = require('../../config/uploadLimits');
const pool = require('../../config/db');
const { getTotalAmountOfPurchaseOrder } = require('../../utils/purchaseOrderGst');
const { nextPurchaseOrderNumber } = require('../../services/vendorNumberService');
const { logVendorAudit } = require('../../services/vendorAuditLogService');
const { allocateTtsplCodes } = require('../../services/vendorInventoryAssetCodeService');
const {
  normalizeIncomingLines,
  buildAssetsDetailsFromLines,
  lineSubtotalFromRows,
  insertProductDetailsForPo
} = require('../../services/purchaseOrderProductDetailsService');
const { createTicketFromGrnReceive } = require('../../services/grnTicketService');
const { markTokenUsed } = require('../../services/grnSerialCaptureService');
const { generatePurchaseOrderPdf } = require('../../services/vendorPurchaseOrderPdfService');
const {
  sendPurchaseOrderApprovedEmail,
  sendPoPendingApprovalEmailToManagers,
} = require('../../services/vendorPoEmailService');

/**
 * Extract the laptop configuration from a PO line so it can be persisted on the
 * received serial's `extra`. The floor ticket detail view reads gpu / screen_size
 * / generation / os from `vendor_serial_numbers.extra`, so we capture the full
 * config at GRN receive time (otherwise those fields render blank on the ticket).
 * Returns only the non-empty fields to keep `extra` clean.
 */
function buildConfigExtraFromLine(line) {
  if (!line || typeof line !== 'object') return {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = line[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const config = {
    brand: pick('brand', 'Brand', 'brand_name'),
    model: pick('model', 'Model', 'product_name', 'model_name'),
    processor: pick('processor', 'Processor', 'cpu'),
    generation: pick('generation', 'Generation'),
    ram: pick('ram', 'RAM'),
    storage: pick('storage', 'Storage'),
    gpu: pick('gpu', 'GPU', 'graphics'),
    screen_size: pick('screen_size', 'Screen size', 'screen_size_inches', 'screen', 'display_size'),
    os: pick('os', 'OS', 'operating_system'),
  };
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ''));
}

/** Normalize JSONB/array/string line_items → array */
function parseLineItemsJson(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Laravel view_purchase_order: each product_detail row gets receivedQty from goods_receipt + po.
 * CRM: sum vendor_serial_numbers per PO keyed by extra.line_index or extra.product_detail_id / product_id / pro_id.
 */
async function buildReceivedQtyMapsForPoIds(poIds) {
  const map = new Map(); // po_id -> { byIdx: {}, byPd: {}, unalloc: number }
  if (!Array.isArray(poIds) || !poIds.length) return map;

  const r = await pool.query(
    `SELECT po_id, extra FROM vendor_serial_numbers
     WHERE po_id = ANY($1::int[]) AND deleted_at IS NULL`,
    [poIds]
  );

  function ensure(pid) {
    if (!map.has(pid)) map.set(pid, { byIdx: {}, byPd: {}, unalloc: 0 });
    return map.get(pid);
  }

  for (const row of r.rows) {
    const pid = Number(row.po_id);
    const m = ensure(pid);
    const ex =
      row.extra && typeof row.extra === 'object' && row.extra !== null && !Array.isArray(row.extra) ? row.extra : {};
    const liRaw = ex.line_index;
    const pdRaw = ex.product_detail_id ?? ex.pro_id ?? ex.product_id;

    if (liRaw !== undefined && liRaw !== null && String(liRaw).trim() !== '') {
      const li = Number(liRaw);
      if (Number.isFinite(li) && li >= 0) {
        const k = String(li);
        m.byIdx[k] = (m.byIdx[k] || 0) + 1;
        continue;
      }
    }

    if (pdRaw !== undefined && pdRaw !== null && String(pdRaw).trim() !== '') {
      const k = String(pdRaw);
      m.byPd[k] = (m.byPd[k] || 0) + 1;
      continue;
    }

    m.unalloc += 1;
  }
  return map;
}

function enrichLineItemsWithReceived(lineItems, info) {
  if (!Array.isArray(lineItems) || !info) return lineItems;
  const { byIdx, byPd, unalloc } = info;

  const out = lineItems.map((row, idx) => {
    const preset = Number(row.receivedQty ?? row.received_qty ?? 0) || 0;
    const pd = row.product_detail_id ?? row.product_id ?? row.pro_id ?? row.id;
    let computed = 0;
    if (pd != null && String(pd).trim() !== '') {
      const v = byPd[String(pd)];
      if (v != null) computed = v;
    }
    if (!computed && byIdx[String(idx)] != null) computed = byIdx[String(idx)];
    const receivedQty = Math.max(preset, computed || 0);
    return { ...row, receivedQty };
  });

  /* Serials logged without line/product: attribute to sole line like single-SKU receipts */
  if (out.length === 1 && unalloc > 0) {
    out[0] = { ...out[0], receivedQty: (Number(out[0].receivedQty) || 0) + unalloc };
  } else if (out.length > 1 && unalloc > 0) {
    const i = out.findIndex((row) => (Number(row.quantity) || 0) > (Number(row.receivedQty) || 0));
    const t = i >= 0 ? i : 0;
    out[t] = { ...out[t], receivedQty: (Number(out[t].receivedQty) || 0) + unalloc };
  }

  return out;
}

function attachProductDetails(poRow, qtyMaps) {
  const lines = parseLineItemsJson(poRow.line_items);
  const ri = qtyMaps.get(Number(poRow.po_id));
  const enriched = enrichLineItemsWithReceived(lines, ri);
  return {
    ...poRow,
    line_items: enriched,
    product_details: enriched
  };
}

/** Receive page opens after manager approval (incl. vendor accepted / in progress). */
function receiveViewAllowed(poRow) {
  const st = String(poRow?.status || '').toLowerCase();
  return ['approved', 'vendor_accepted', 'sent', 'processing', 'completed'].includes(st);
}

/** New serial receipts while PO is approved, vendor-accepted, or in progress. */
function receiveMutationAllowed(poRow) {
  const st = String(poRow?.status || '').toLowerCase();
  return ['approved', 'vendor_accepted', 'sent', 'processing'].includes(st);
}

async function syncPoBillFromGrn(poId, billName, billFiles = []) {
  if (!billName && (!billFiles || !billFiles.length)) return;
  const filesJson = JSON.stringify(Array.isArray(billFiles) ? billFiles : []);
  await pool.query(
    `UPDATE vendor_purchase_orders
     SET bill_name = COALESCE(bill_name, $1),
         bill_files = CASE
           WHEN bill_files IS NULL OR bill_files = '[]'::jsonb THEN $2::jsonb
           ELSE bill_files
         END,
         updated_at = NOW()
     WHERE po_id = $3 AND deleted_at IS NULL`,
    [billName || null, filesJson, poId]
  );
}

async function computeReceiveTotalsForPoId(poId) {
  const r = await pool.query(
    `SELECT line_items FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`,
    [poId]
  );
  if (!r.rows.length) return null;
  const qtyMaps = await buildReceivedQtyMapsForPoIds([poId]);
  const lines = enrichLineItemsWithReceived(parseLineItemsJson(r.rows[0].line_items), qtyMaps.get(poId));
  let orderQty = 0;
  let receivedQty = 0;
  lines.forEach((l) => {
    orderQty += Number(l.quantity) || 0;
    receivedQty += Number(l.receivedQty) || 0;
  });
  return { orderQty, receivedQty };
}

/**
 * While receiving: PO → processing. When every ordered unit has a serial: → completed.
 * Called after successful inserts into vendor_serial_numbers.
 */
async function syncPoReceiveProgressStatus(poId, actorUserId) {
  const cur = await pool.query(
    `SELECT status FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`,
    [poId]
  );
  if (!cur.rows.length) return;
  const st = String(cur.rows[0].status || '').toLowerCase();
  if (!['approved', 'vendor_accepted', 'sent', 'processing'].includes(st)) return;

  const totals = await computeReceiveTotalsForPoId(poId);
  if (!totals || totals.orderQty <= 0) return;

  let next = null;
  if (totals.receivedQty >= totals.orderQty) next = 'completed';
  else if (totals.receivedQty > 0) next = 'processing';

  if (next && next !== st) {
    await pool.query(
      `UPDATE vendor_purchase_orders SET status = $1, status_updated_by_admin_id = $2, updated_at = NOW()
       WHERE po_id = $3 AND deleted_at IS NULL`,
      [next, actorUserId ?? null, poId]
    );
    await logVendorAudit({
      actorUserId: actorUserId ?? null,
      vendorId: null,
      entityType: 'purchase_order',
      entityId: poId,
      action: 'status_auto_receive_progress',
      payload: { from: st, to: next }
    });
  }
}

const productReceivedValidators = [param('poId').isInt().toInt()];

async function getProductReceivedContext(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const poId = Number(req.params.poId);
  const r = await pool.query(
    `SELECT
      p.*,
      v.first_name AS vendor_first_name,
      v.business_name AS vendor_business_name,
      v.email AS vendor_email,
      v.phone AS vendor_phone,
      v.address AS vendor_address,
      v.state AS vendor_state,
      COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_display_name
     FROM vendor_purchase_orders p
     LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
     WHERE p.po_id = $1 AND p.deleted_at IS NULL`,
    [poId]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const row = r.rows[0];
  if (!receiveViewAllowed(row)) {
    return res.status(403).json({
      success: false,
      message:
        'Goods receiving opens after manager approval. Approve the PO first, then use the receive (eye) action.'
    });
  }

  const qtyMaps = await buildReceivedQtyMapsForPoIds([poId]);
  const enriched = attachProductDetails(row, qtyMaps);
  const lines = enriched.product_details || [];

  const grnsR = await pool.query(
    `SELECT * FROM vendor_goods_received_notes WHERE po_id = $1 AND deleted_at IS NULL ORDER BY grn_id`,
    [poId]
  );

  let orderQty = 0;
  let receivedQty = 0;
  lines.forEach((l) => {
    const q = Number(l.quantity) || 0;
    orderQty += q;
    receivedQty += Number(l.receivedQty) || 0;
  });

  res.json({
    success: true,
    data: {
      purchase_order: {
        po_id: enriched.po_id,
        purchase_order_number: enriched.purchase_order_number,
        purchase_order_type: enriched.purchase_order_type,
        purchase_order_date: enriched.purchase_order_date,
        status: enriched.status,
        remarks: enriched.remarks,
        updated_at: enriched.updated_at,
        vendor_id: enriched.vendor_id,
        vendor_display_name: enriched.vendor_display_name,
        vendor_first_name: enriched.vendor_first_name,
        vendor_business_name: enriched.vendor_business_name,
        vendor_email: enriched.vendor_email,
        vendor_phone: enriched.vendor_phone,
        vendor_address: enriched.vendor_address
      },
      lines,
      stats: {
        total_lines: lines.length,
        order_qty: orderQty,
        received_qty: receivedQty,
        remaining_qty: Math.max(0, orderQty - receivedQty)
      },
      grns: grnsR.rows
    }
  });
}

const receiveSerialValidators = [
  param('poId').isInt().toInt(),
  body('line_index').isInt({ min: 0 }).toInt(),
  body('serial_number').trim().notEmpty(),
  body('grn_id').optional({ nullable: true }).isInt().toInt()
];

async function receiveProductSerial(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const poId = Number(req.params.poId);
  const lineIndex = Number(req.body.line_index);
  const serial_number = String(req.body.serial_number || '').trim();

  let grnId =
    req.body.grn_id === '' || req.body.grn_id === undefined || req.body.grn_id === null
      ? null
      : Number(req.body.grn_id);

  const r = await pool.query(`SELECT * FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`, [
    poId
  ]);
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  const po = r.rows[0];
  if (!receiveMutationAllowed(po)) {
    const stPo = String(po.status || '').toLowerCase();
    if (stPo === 'completed') {
      return res.status(403).json({
        success: false,
        message: 'This purchase order is fully received; receipts are closed.'
      });
    }
    return res.status(403).json({
      success: false,
      message:
        'Receiving opens only once the PO is approved (invoice uploaded and Approved on the purchase order list).'
    });
  }

  const qtyMaps = await buildReceivedQtyMapsForPoIds([poId]);
  const lines = enrichLineItemsWithReceived(parseLineItemsJson(po.line_items), qtyMaps.get(poId));
  const line = lines[lineIndex];
  if (!line) {
    return res.status(400).json({ success: false, message: 'Invalid line_index for this PO' });
  }

  const ordered = Number(line.quantity) || 0;
  const currentReceived = Number(line.receivedQty) || 0;
  if (currentReceived + 1 > ordered) {
    return res.status(400).json({
      success: false,
      message: 'Cannot receive more units than ordered for this line.'
    });
  }

  const pd = line.product_detail_id ?? line.product_id ?? line.pro_id ?? line.id;
  const extra = { line_index: lineIndex, ...buildConfigExtraFromLine(line) };
  if (pd != null && String(pd).trim() !== '') extra.product_detail_id = String(pd);

  const client = await pool.connect();
  let finalGrnId;
  let serialId;
  try {
    await client.query('BEGIN');

    if (grnId != null && Number.isFinite(grnId)) {
      const g = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE grn_id = $1 AND po_id = $2 AND deleted_at IS NULL`,
        [grnId, poId]
      );
      if (!g.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid GRN for this purchase order.' });
      }
      finalGrnId = grnId;
    } else {
      const last = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE po_id = $1 AND deleted_at IS NULL ORDER BY grn_id DESC LIMIT 1`,
        [poId]
      );
      if (last.rows.length) finalGrnId = last.rows[0].grn_id;
      else {
        const insG = await client.query(
          `INSERT INTO vendor_goods_received_notes (po_id, meta) VALUES ($1, '{}'::jsonb) RETURNING grn_id`,
          [poId]
        );
        finalGrnId = insG.rows[0].grn_id;
      }
    }

    const insS = await client.query(
      `INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, qc_status, extra)
       VALUES ($1,$2,$3,'pending',$4::jsonb) RETURNING serial_id`,
      [poId, finalGrnId, serial_number, JSON.stringify(extra)]
    );
    serialId = insS.rows[0].serial_id;

    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (String(e.code) === '23505') {
      return res.status(409).json({ success: false, message: 'Serial number already exists' });
    }
    console.error(e);
    return res.status(500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: po.vendor_id || null,
    entityType: 'serial_number',
    entityId: String(serialId),
    action: 'receive_on_po_line',
    payload: { po_id: poId, grn_id: finalGrnId, line_index: lineIndex }
  });

  await syncPoReceiveProgressStatus(poId, req.user?.user_id);

  let ticketResult = null;
  try {
    const serialRow = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serialId]
    );
    const row = serialRow.rows[0];
    if (row) {
      ticketResult = await createTicketFromGrnReceive(pool, {
        serialId: row.serial_id,
        serialNumber: row.serial_number,
        inventoryAssetCode: row.inventory_asset_code,
        po,
        line,
        actorUserId: req.user?.user_id
      });
    }
  } catch (ticketErr) {
    console.error('GRN ticket creation failed (single receive):', ticketErr);
    ticketResult = { ok: false, error: ticketErr.message };
  }

  const qtyMaps2 = await buildReceivedQtyMapsForPoIds([poId]);
  const lines2 = enrichLineItemsWithReceived(parseLineItemsJson(po.line_items), qtyMaps2.get(poId));

  res.status(201).json({
    success: true,
    message: 'Serial recorded against this PO line.',
    data: { grn_id: finalGrnId, serial_id: serialId, lines: lines2, ticket: ticketResult }
  });
}

/** Multi-unit receive with rental_start_date + auto TTSPL codes (mirrors Laravel multi-serial modal). */
const RECEIVE_PO_BULK_CAP = 250;

const receivePoLineBulkValidators = [
  param('poId').isInt().toInt(),
  body('line_index').isInt({ min: 0 }).toInt(),
  body('rental_start_date')
    .notEmpty()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('rental_start_date must be YYYY-MM-DD'),
  body('quantity').isInt({ min: 1, max: RECEIVE_PO_BULK_CAP }).toInt(),
  body('serial_numbers').isArray({ min: 1 }).withMessage('serial_numbers required'),
  body('serial_numbers.*').trim().notEmpty(),
  body('grn_id').optional({ nullable: true }).isInt().toInt(),
  body('bill_status').optional().isIn(['pending', 'received']),
  body('bill_name').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body().custom((_v, { req }) => {
    const q = Number(req.body.quantity);
    const arr = req.body.serial_numbers;
    if (!Array.isArray(arr) || arr.length !== q) {
      throw new Error('serial_numbers must contain exactly quantity entries');
    }
    const norm = arr.map((s) => String(s || '').trim().toUpperCase());
    const set = new Set(norm);
    if (set.size !== norm.length) {
      throw new Error('Duplicate serial numbers in this submission');
    }
    return true;
  })
];

async function receivePoLineBulk(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const poId = Number(req.params.poId);
  const lineIndex = Number(req.body.line_index);
  const rental_start_date = String(req.body.rental_start_date).trim();
  const quantity = Number(req.body.quantity);

  let grnId =
    req.body.grn_id === '' || req.body.grn_id === undefined || req.body.grn_id === null
      ? null
      : Number(req.body.grn_id);

  const serialsRaw = req.body.serial_numbers;
  const serialsNorm = serialsRaw.map((s) => String(s || '').trim().toUpperCase());

  const r = await pool.query(`SELECT * FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`, [
    poId
  ]);
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  const po = r.rows[0];
  if (!receiveMutationAllowed(po)) {
    const stPo = String(po.status || '').toLowerCase();
    if (stPo === 'completed') {
      return res.status(403).json({
        success: false,
        message: 'This purchase order is fully received; receipts are closed.'
      });
    }
    return res.status(403).json({
      success: false,
      message:
        'Receiving opens only once the PO is approved (invoice uploaded and Approved on the purchase order list).'
    });
  }

  const qtyMapsBefore = await buildReceivedQtyMapsForPoIds([poId]);
  const linesBefore = enrichLineItemsWithReceived(parseLineItemsJson(po.line_items), qtyMapsBefore.get(poId));
  const line = linesBefore[lineIndex];
  if (!line) {
    return res.status(400).json({ success: false, message: 'Invalid line_index for this PO' });
  }

  const ordered = Number(line.quantity) || 0;
  const currentReceived = Number(line.receivedQty) || 0;
  const remaining = Math.max(0, ordered - currentReceived);
  if (quantity > remaining) {
    return res.status(400).json({
      success: false,
      message: `Cannot receive ${quantity} units; only ${remaining} remaining on this line.`
    });
  }

  const pd = line.product_detail_id ?? line.product_id ?? line.pro_id ?? line.id;

  const client = await pool.connect();
  let finalGrnId;
  const createdRows = [];

  try {
    await client.query('BEGIN');

    const dup = await client.query(
      `SELECT serial_number FROM vendor_serial_numbers
       WHERE deleted_at IS NULL AND LOWER(serial_number) = ANY($1::text[])`,
      [serialsNorm.map((s) => s.toLowerCase())]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Serial already exists in inventory: ${dup.rows.map((row) => row.serial_number).join(', ')}`
      });
    }

    if (grnId != null && Number.isFinite(grnId)) {
      const g = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE grn_id = $1 AND po_id = $2 AND deleted_at IS NULL`,
        [grnId, poId]
      );
      if (!g.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid GRN for this purchase order.' });
      }
      finalGrnId = grnId;
    } else {
      const last = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE po_id = $1 AND deleted_at IS NULL ORDER BY grn_id DESC LIMIT 1`,
        [poId]
      );
      if (last.rows.length) finalGrnId = last.rows[0].grn_id;
      else {
        const insG = await client.query(
          `INSERT INTO vendor_goods_received_notes (po_id, meta) VALUES ($1, '{}'::jsonb) RETURNING grn_id`,
          [poId]
        );
        finalGrnId = insG.rows[0].grn_id;
      }
    }

    const billStatus = String(req.body.bill_status || 'pending').toLowerCase() === 'received' ? 'received' : 'pending';
    const billName = billStatus === 'received' ? String(req.body.bill_name || '').trim() || null : null;

    await client.query(
      `UPDATE vendor_goods_received_notes
       SET bill_status = $1, bill_name = COALESCE($2, bill_name), updated_at = NOW()
       WHERE grn_id = $3`,
      [billStatus, billName, finalGrnId]
    );

    if (billStatus === 'received' && billName) {
      await client.query(
        `UPDATE vendor_purchase_orders
         SET bill_name = COALESCE(bill_name, $1), updated_at = NOW()
         WHERE po_id = $2 AND deleted_at IS NULL`,
        [billName, poId]
      );
    }

    const assetCodes = await allocateTtsplCodes(client, quantity);

    for (let i = 0; i < quantity; i += 1) {
      const serial_number = serialsNorm[i];
      const inventory_asset_code = assetCodes[i];
      const extra = {
        line_index: lineIndex,
        rental_start_date,
        unique_product_serial: inventory_asset_code,
        ...buildConfigExtraFromLine(line)
      };
      if (pd != null && String(pd).trim() !== '') extra.product_detail_id = String(pd);

      const insS = await client.query(
        `INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_asset_code, rental_start_date, qc_status, extra)
         VALUES ($1,$2,$3,$4,$5::date,'pending',$6::jsonb) RETURNING serial_id`,
        [poId, finalGrnId, serial_number, inventory_asset_code, rental_start_date, JSON.stringify(extra)]
      );
      createdRows.push({
        serial_id: insS.rows[0].serial_id,
        serial_number,
        inventory_asset_code
      });
    }

    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (String(e.code) === '23505') {
      return res.status(409).json({ success: false, message: 'Serial number or inventory code already exists' });
    }
    console.error(e);
    return res.status(500).json({ success: false, message: e.message || 'Bulk receive failed' });
  } finally {
    client.release();
  }

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: po.vendor_id || null,
    entityType: 'serial_number_bulk',
    entityId: String(poId),
    action: 'receive_bulk_on_po_line',
    payload: {
      po_id: poId,
      grn_id: finalGrnId,
      line_index: lineIndex,
      qty: quantity,
      rental_start_date,
      inventory_codes: createdRows.map((x) => x.inventory_asset_code)
    }
  });

  await syncPoReceiveProgressStatus(poId, req.user?.user_id);

  const ticketResults = [];
  for (const row of createdRows) {
    try {
      const tr = await createTicketFromGrnReceive(pool, {
        serialId: row.serial_id,
        serialNumber: row.serial_number,
        inventoryAssetCode: row.inventory_asset_code,
        po,
        line,
        actorUserId: req.user?.user_id
      });
      ticketResults.push(tr);
    } catch (ticketErr) {
      console.error('GRN ticket creation failed (bulk receive):', row.serial_number, ticketErr);
      ticketResults.push({ ok: false, serial_number: row.serial_number, error: ticketErr.message });
    }
  }

  const qtyMapsAfter = await buildReceivedQtyMapsForPoIds([poId]);
  const linesAfter = enrichLineItemsWithReceived(parseLineItemsJson(po.line_items), qtyMapsAfter.get(poId));

  const ticketsCreated = ticketResults.filter((t) => t.ok).length;
  res.status(201).json({
    success: true,
    message:
      ticketsCreated > 0
        ? `${quantity} unit(s) received with asset codes. ${ticketsCreated} repair ticket(s) created for Floor Manager.`
        : `${quantity} unit(s) received with asset codes.`,
    data: {
      grn_id: finalGrnId,
      rental_start_date,
      created: createdRows,
      lines: linesAfter,
      tickets: ticketResults
    }
  });
}

/** Single-unit receive (sequential GRN wizard) — one serial + TTSPL + ticket per call */
const receivePoLineUnitValidators = [
  param('poId').isInt().toInt(),
  body('line_index').isInt({ min: 0 }).toInt(),
  body('rental_start_date')
    .notEmpty()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('rental_start_date must be YYYY-MM-DD'),
  body('serial_number').trim().notEmpty(),
  body('grn_id').optional({ nullable: true }).isInt().toInt(),
  body('bill_status').optional().isIn(['pending', 'received']),
  body('bill_name').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body('apply_bill_settings').optional().isBoolean().toBoolean(),
  body('capture_token').optional({ nullable: true }).isUUID(),
];

async function receivePoLineUnit(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const poId = Number(req.params.poId);
  const lineIndex = Number(req.body.line_index);
  const rental_start_date = String(req.body.rental_start_date).trim();
  const serial_number = String(req.body.serial_number || '').trim().toUpperCase();
  const applyBill = req.body.apply_bill_settings === true || req.body.apply_bill_settings === 'true';
  const captureToken = req.body.capture_token || null;

  let grnId =
    req.body.grn_id === '' || req.body.grn_id === undefined || req.body.grn_id === null
      ? null
      : Number(req.body.grn_id);

  const r = await pool.query(`SELECT * FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`, [
    poId
  ]);
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  const po = r.rows[0];
  if (!receiveMutationAllowed(po)) {
    const stPo = String(po.status || '').toLowerCase();
    if (stPo === 'completed') {
      return res.status(403).json({
        success: false,
        message: 'This purchase order is fully received; receipts are closed.'
      });
    }
    return res.status(403).json({
      success: false,
      message:
        'Receiving opens only once the PO is approved (invoice uploaded and Approved on the purchase order list).'
    });
  }

  const qtyMapsBefore = await buildReceivedQtyMapsForPoIds([poId]);
  const linesBefore = enrichLineItemsWithReceived(parseLineItemsJson(po.line_items), qtyMapsBefore.get(poId));
  const line = linesBefore[lineIndex];
  if (!line) {
    return res.status(400).json({ success: false, message: 'Invalid line_index for this PO' });
  }

  const ordered = Number(line.quantity) || 0;
  const currentReceived = Number(line.receivedQty) || 0;
  if (currentReceived + 1 > ordered) {
    return res.status(400).json({
      success: false,
      message: 'Cannot receive more units than ordered for this line.'
    });
  }

  const pd = line.product_detail_id ?? line.product_id ?? line.pro_id ?? line.id;
  const client = await pool.connect();
  let finalGrnId;
  let createdRow = null;

  try {
    await client.query('BEGIN');

    const dup = await client.query(
      `SELECT serial_number FROM vendor_serial_numbers
       WHERE deleted_at IS NULL AND LOWER(serial_number) = LOWER($1)`,
      [serial_number]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Serial already exists in inventory: ${dup.rows[0].serial_number}`
      });
    }

    if (grnId != null && Number.isFinite(grnId)) {
      const g = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE grn_id = $1 AND po_id = $2 AND deleted_at IS NULL`,
        [grnId, poId]
      );
      if (!g.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid GRN for this purchase order.' });
      }
      finalGrnId = grnId;
    } else {
      const last = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE po_id = $1 AND deleted_at IS NULL ORDER BY grn_id DESC LIMIT 1`,
        [poId]
      );
      if (last.rows.length) finalGrnId = last.rows[0].grn_id;
      else {
        const insG = await client.query(
          `INSERT INTO vendor_goods_received_notes (po_id, meta) VALUES ($1, '{}'::jsonb) RETURNING grn_id`,
          [poId]
        );
        finalGrnId = insG.rows[0].grn_id;
      }
    }

    if (applyBill) {
      const billStatus = String(req.body.bill_status || 'pending').toLowerCase() === 'received' ? 'received' : 'pending';
      const billName = billStatus === 'received' ? String(req.body.bill_name || '').trim() || null : null;

      await client.query(
        `UPDATE vendor_goods_received_notes
         SET bill_status = $1, bill_name = COALESCE($2, bill_name), updated_at = NOW()
         WHERE grn_id = $3`,
        [billStatus, billName, finalGrnId]
      );

      if (billStatus === 'received' && billName) {
        await client.query(
          `UPDATE vendor_purchase_orders
           SET bill_name = COALESCE(bill_name, $1), updated_at = NOW()
           WHERE po_id = $2 AND deleted_at IS NULL`,
          [billName, poId]
        );
      }
    }

    const assetCodes = await allocateTtsplCodes(client, 1);
    const inventory_asset_code = assetCodes[0];
    const extra = {
      line_index: lineIndex,
      rental_start_date,
      unique_product_serial: inventory_asset_code,
      ...buildConfigExtraFromLine(line)
    };
    if (pd != null && String(pd).trim() !== '') extra.product_detail_id = String(pd);

    const insS = await client.query(
      `INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_asset_code, rental_start_date, qc_status, extra)
       VALUES ($1,$2,$3,$4,$5::date,'pending',$6::jsonb) RETURNING serial_id`,
      [poId, finalGrnId, serial_number, inventory_asset_code, rental_start_date, JSON.stringify(extra)]
    );
    createdRow = {
      serial_id: insS.rows[0].serial_id,
      serial_number,
      inventory_asset_code
    };

    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (String(e.code) === '23505') {
      return res.status(409).json({ success: false, message: 'Serial number or inventory code already exists' });
    }
    console.error(e);
    return res.status(500).json({ success: false, message: e.message || 'Receive failed' });
  } finally {
    client.release();
  }

  if (captureToken) {
    try {
      await markTokenUsed(captureToken);
    } catch (tokenErr) {
      console.warn('markTokenUsed failed:', tokenErr.message);
    }
  }

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: po.vendor_id || null,
    entityType: 'serial_number',
    entityId: String(createdRow.serial_id),
    action: 'receive_unit_on_po_line',
    payload: {
      po_id: poId,
      grn_id: finalGrnId,
      line_index: lineIndex,
      rental_start_date,
      inventory_asset_code: createdRow.inventory_asset_code
    }
  });

  await syncPoReceiveProgressStatus(poId, req.user?.user_id);

  let ticketResult = null;
  try {
    ticketResult = await createTicketFromGrnReceive(pool, {
      serialId: createdRow.serial_id,
      serialNumber: createdRow.serial_number,
      inventoryAssetCode: createdRow.inventory_asset_code,
      po,
      line,
      actorUserId: req.user?.user_id
    });
  } catch (ticketErr) {
    console.error('GRN ticket creation failed (unit receive):', ticketErr);
    ticketResult = { ok: false, error: ticketErr.message };
  }

  const qtyMapsAfter = await buildReceivedQtyMapsForPoIds([poId]);
  const linesAfter = enrichLineItemsWithReceived(parseLineItemsJson(po.line_items), qtyMapsAfter.get(poId));

  res.status(201).json({
    success: true,
    message: ticketResult?.ok
      ? `Unit received as ${createdRow.inventory_asset_code}. Repair ticket created for Floor Manager.`
      : `Unit received as ${createdRow.inventory_asset_code}.`,
    data: {
      grn_id: finalGrnId,
      rental_start_date,
      created: createdRow,
      lines: linesAfter,
      ticket: ticketResult
    }
  });
}

/** Laravel view_purchase_order_detail + getReceivedProductsDetailsByPO (grouped GRN rows with counts). */
const generatedGrnValidators = [param('poId').isInt().toInt()];

async function getGeneratedGrnOverview(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const poId = Number(req.params.poId);
  const r = await pool.query(
    `SELECT
      p.*,
      v.first_name AS vendor_first_name,
      v.business_name AS vendor_business_name,
      v.email AS vendor_email,
      v.phone AS vendor_phone,
      v.address AS vendor_address,
      v.state AS vendor_state,
      COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_display_name
     FROM vendor_purchase_orders p
     LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
     WHERE p.po_id = $1 AND p.deleted_at IS NULL`,
    [poId]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const row = r.rows[0];
  const qtyMaps = await buildReceivedQtyMapsForPoIds([poId]);
  const enriched = attachProductDetails(row, qtyMaps);
  const lines = enriched.product_details || [];

  let orderQty = 0;
  let receivedQty = 0;
  lines.forEach((l) => {
    const q = Number(l.quantity) || 0;
    orderQty += q;
    receivedQty += Number(l.receivedQty) || 0;
  });

  const grnRows = await pool.query(
    `
    SELECT
      g.grn_id,
      g.created_at,
      g.updated_at,
      g.bill_status,
      g.bill_name,
      g.bill_files,
      COUNT(s.serial_id)::int AS received_qty,
      ('GRN-' || LPAD(g.grn_id::text, 4, '0')) AS grn_number
    FROM vendor_goods_received_notes g
    LEFT JOIN vendor_serial_numbers s
      ON s.grn_id = g.grn_id AND s.po_id = g.po_id AND s.deleted_at IS NULL
    WHERE g.po_id = $1 AND g.deleted_at IS NULL
    GROUP BY g.grn_id, g.created_at, g.updated_at, g.bill_status, g.bill_name, g.bill_files
    ORDER BY g.grn_id DESC
    `,
    [poId]
  );

  res.json({
    success: true,
    data: {
      purchase_order: {
        po_id: enriched.po_id,
        purchase_order_number: enriched.purchase_order_number,
        purchase_order_type: enriched.purchase_order_type,
        purchase_order_date: enriched.purchase_order_date,
        status: enriched.status,
        remarks: enriched.remarks,
        updated_at: enriched.updated_at,
        vendor_id: enriched.vendor_id,
        vendor_display_name: enriched.vendor_display_name,
        vendor_first_name: enriched.vendor_first_name,
        vendor_business_name: enriched.vendor_business_name,
        vendor_email: enriched.vendor_email,
        vendor_phone: enriched.vendor_phone,
        vendor_address: enriched.vendor_address
      },
      lines,
      stats: {
        total_lines: lines.length,
        order_qty: orderQty,
        received_qty: receivedQty,
        remaining_qty: Math.max(0, orderQty - receivedQty)
      },
      grn_rows: grnRows.rows
    }
  });
}

/** Laravel getGRNDetails: serial lines joined to PO line_items via extra.line_index. */
const grnReceivedProductsValidators = [param('poId').isInt().toInt(), param('grnId').isInt().toInt()];

function formatGrnNumber(grnId) {
  return `GRN-${String(grnId).padStart(4, '0')}`;
}

async function getGrnReceivedProducts(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const poId = Number(req.params.poId);
  const grnId = Number(req.params.grnId);

  const g = await pool.query(
    `SELECT * FROM vendor_goods_received_notes WHERE grn_id = $1 AND po_id = $2 AND deleted_at IS NULL`,
    [grnId, poId]
  );
  if (!g.rows.length) {
    return res.status(404).json({ success: false, message: 'GRN not found for this purchase order' });
  }

  const poR = await pool.query(
    `SELECT line_items FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`,
    [poId]
  );
  const lineItems = parseLineItemsJson(poR.rows[0]?.line_items);

  const serials = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, rental_start_date, extra, created_at FROM vendor_serial_numbers
     WHERE po_id = $1 AND grn_id = $2 AND deleted_at IS NULL
     ORDER BY serial_id`,
    [poId, grnId]
  );

  const grn = g.rows[0];
  const items = serials.rows.map((s) => {
    const ex = s.extra && typeof s.extra === 'object' && s.extra !== null && !Array.isArray(s.extra) ? s.extra : {};
    const li = Number(ex.line_index);
    const line = Number.isFinite(li) && li >= 0 && lineItems[li] ? lineItems[li] : {};
    const rep = ex.is_replaced === true || ex.is_replaced === 1 || String(ex.is_replaced) === '1';
    const repa = ex.is_repaired === true || ex.is_repaired === 1 || String(ex.is_repaired) === '1';
    return {
      serial_id: s.serial_id,
      serial_number: s.serial_number,
      inventory_asset_code: s.inventory_asset_code ?? null,
      rental_start_date: s.rental_start_date ?? ex.rental_start_date ?? null,
      unique_product_serial:
        ex.unique_product_serial ?? ex.unique_number ?? s.inventory_asset_code ?? null,
      is_replaced: rep ? 1 : 0,
      is_repaired: repa ? 1 : 0,
      brand: line.brand ?? null,
      model: line.model ?? null,
      processor: line.processor ?? null,
      generation: line.generation ?? null,
      ram: line.ram ?? null,
      storage: line.storage ?? null,
      gpu: line.gpu ?? null,
      screen_size: line.screen_size ?? null,
      grn_date: grn.updated_at ?? grn.created_at
    };
  });

  res.json({
    success: true,
    data: {
      grn_id: grnId,
      grn_number: formatGrnNumber(grnId),
      created_at: grn.created_at,
      updated_at: grn.updated_at,
      items
    }
  });
}

function lineSubtotal(lineItems) {
  if (!Array.isArray(lineItems)) return 0;
  let s = 0;
  lineItems.forEach((row) => {
    const r = Number(row.rate);
    const q = Number(row.quantity);
    if (!Number.isFinite(r)) return;
    s += r * (Number.isFinite(q) ? q : 0);
  });
  return Math.round(s * 100) / 100;
}

async function vendorState(vendor_id) {
  const r = await pool.query(`SELECT state FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [vendor_id]);
  return r.rows[0]?.state || null;
}

const listValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('vendor_id').optional().isInt().toInt(),
  query('search').optional().isString().trim()
];

async function list(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 25;
  const offset = (page - 1) * limit;
  const vid = req.query.vendor_id;

  let where = `p.deleted_at IS NULL`;
  const p = [];
  let idx = 1;
  const search = (req.query.search || '').trim();

  if (vid) {
    where += ` AND p.vendor_id = $${idx}`;
    p.push(vid);
    idx += 1;
  }
  if (search) {
    where += ` AND (
      p.purchase_order_number ILIKE $${idx}
      OR p.purchase_order_type ILIKE $${idx}
      OR COALESCE(p.remarks,'') ILIKE $${idx}
      OR COALESCE(v.business_name,'') ILIKE $${idx}
      OR COALESCE(v.first_name,'') ILIKE $${idx}
    )`;
    p.push(`%${search}%`);
    idx += 1;
  }

  const cnt = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM vendor_purchase_orders p
     LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
     WHERE ${where}`,
    p
  );
  const total = cnt.rows[0].c;

  const data = await pool.query(
    `
    SELECT
      p.*,
      v.first_name AS vendor_first_name,
      v.business_name AS vendor_business_name,
      COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_display_name
    FROM vendor_purchase_orders p
    LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
    WHERE ${where}
    ORDER BY p.po_id DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `,
    [...p, limit, offset]
  );

  const poIds = data.rows.map((row) => row.po_id);
  const qtyMaps = await buildReceivedQtyMapsForPoIds(poIds);

  const rowsOut = data.rows.map((row) => attachProductDetails(row, qtyMaps));

  res.json({
    success: true,
    data: rowsOut,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
  });
}

async function nextNumber(req, res) {
  const num = await nextPurchaseOrderNumber();
  res.json({ success: true, purchase_order_number: num });
}

/** Dropdown source for PO asset rows — Settings → Asset Configuration (DB). */
async function fetchPoAssetCatalogOptions() {
  const { getAssetCatalogForApi } = require('../../services/assetConfigurationService');
  const cat = await getAssetCatalogForApi({ includeLegacyRows: true });
  return {
    brands: cat.brands,
    models: cat.models_flat,
    models_by_brand: cat.models_by_brand,
    processors: cat.processors,
    generations: cat.generations_flat,
    generations_by_processor: cat.generations_by_processor,
    rams: cat.rams,
    storages: cat.storages,
    gpus: cat.gpus,
    screen_sizes: cat.screen_sizes,
    from_asset_config: cat.from_asset_config,
  };
}

/** Next PO number + approved vendors for create form (Laravel PO form parity) */
async function formMeta(req, res) {
  try {
    const purchase_order_number = await nextPurchaseOrderNumber();
    const vendors = await pool.query(
      `SELECT vendor_id, first_name, business_name, email, phone, address, state
       FROM vendors
       WHERE deleted_at IS NULL AND status = 'approved'
       ORDER BY business_name ASC NULLS LAST, vendor_id DESC
       LIMIT 500`
    );
    const asset_catalog = await fetchPoAssetCatalogOptions();
    res.json({
      success: true,
      purchase_order_number,
      asset_catalog,
      vendors: vendors.rows.map((v) => ({
        id: v.vendor_id,
        label: [v.business_name, v.first_name].filter(Boolean).join(' — ') || `Vendor #${v.vendor_id}`,
        email: v.email,
        phone: v.phone,
        address: v.address,
        state: v.state
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load PO form meta' });
  }
}

function normalizeStateValue(s) {
  if (s == null || s === '') return '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

const getValidators = [param('id').isInt().toInt()];

async function getOne(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const r = await pool.query(
    `SELECT
      p.*,
      v.first_name AS vendor_first_name,
      v.business_name AS vendor_business_name,
      v.email AS vendor_email,
      v.phone AS vendor_phone,
      v.address AS vendor_address,
      v.state AS vendor_state,
      COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_display_name
     FROM vendor_purchase_orders p
     LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
     WHERE p.po_id = $1 AND p.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const qtyMaps = await buildReceivedQtyMapsForPoIds([r.rows[0].po_id]);
  const enriched = attachProductDetails(r.rows[0], qtyMaps);

  res.json({ success: true, data: enriched });
}

async function getByNumber(req, res) {
  const id = req.query.id || req.params.number;
  if (!id) return res.status(400).json({ success: false, message: 'id (PO number) required' });
  const r = await pool.query(
    `SELECT * FROM vendor_purchase_orders WHERE purchase_order_number = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!r.rows.length) {
    return res.json({ success: false, error: 'Purchase Order not found' });
  }
  return res.json({ success: true, details: r.rows[0] });
}

async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const body = req.body;
  const rawLines = normalizeIncomingLines(body);
  if (!rawLines.length) {
    return res.status(400).json({
      success: false,
      message: 'Add at least one asset line (line_items or assetsDetails required)'
    });
  }

  const vendorCheck = await pool.query(
    `SELECT vendor_id, state FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [body.vendor_id]
  );
  if (!vendorCheck.rows.length) {
    return res.status(400).json({ success: false, message: 'Vendor not found' });
  }

  const vState = vendorCheck.rows[0].state;
  const is_same_state =
    typeof body.is_same_state === 'boolean'
      ? body.is_same_state
      : normalizeStateValue(vState) === normalizeStateValue(body.po_state);

  const sub_total_amount = body.sub_total_amount ?? lineSubtotalFromRows(rawLines);
  const total_amount = getTotalAmountOfPurchaseOrder(sub_total_amount, !!is_same_state);

  const purchase_order_number =
    body.purchase_order_number && String(body.purchase_order_number).trim()
      ? String(body.purchase_order_number).trim()
      : await nextPurchaseOrderNumber();

  const dup = await pool.query(
    `SELECT 1 FROM vendor_purchase_orders WHERE purchase_order_number = $1 AND deleted_at IS NULL`,
    [purchase_order_number]
  );
  if (dup.rows.length) {
    return res.status(409).json({ success: false, message: 'PO number already exists' });
  }

  const assets_details =
    body.assets_details != null ? body.assets_details : buildAssetsDetailsFromLines(rawLines);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { insertedIds, enrichedLines } = await insertProductDetailsForPo(
      client,
      null,
      rawLines,
      body.purchase_order_type
    );

    const ins = await client.query(
      `INSERT INTO vendor_purchase_orders (
        purchase_order_number, purchase_order_date, purchase_order_type, vendor_id,
        po_state, is_same_state, sub_total_amount, total_amount,
        line_items, assets_details, product_details_legacy_ids, remarks,
        status, status_updated_by_admin_id, status_updated_by_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        purchase_order_number,
        body.purchase_order_date,
        body.purchase_order_type,
        body.vendor_id,
        body.po_state,
        is_same_state,
        sub_total_amount,
        total_amount,
        JSON.stringify(enrichedLines),
        JSON.stringify(assets_details),
        JSON.stringify(insertedIds),
        body.remarks || null,
        body.status || 'draft',
        req.user?.user_id || null,
        body.status_updated_by_name || 'Admin'
      ]
    );

    const poId = ins.rows[0].po_id;
    await client.query(
      `UPDATE vendor_product_details SET po_id = $1, updated_at = NOW()
       WHERE product_detail_id = ANY($2::int[])`,
      [poId, insertedIds]
    );

    await client.query('COMMIT');

    await logVendorAudit({
      actorUserId: req.user?.user_id,
      vendorId: body.vendor_id,
      entityType: 'purchase_order',
      entityId: poId,
      action: 'create',
      payload: { purchase_order_number, product_detail_ids: insertedIds }
    });

    res.status(201).json({
      success: true,
      message: 'Purchase Order saved successfully',
      data: { ...ins.rows[0], po_id: poId, line_items: enrichedLines, product_details: enrichedLines }
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
}

function createValidators() {
  return [
    body('purchase_order_date').notEmpty(),
    body('purchase_order_type').isIn(['rental_purchase', 'rent_to_own', 'direct_purchase']),
    body('vendor_id').isInt().toInt(),
    body('po_state').trim().notEmpty(),
    body('remarks').trim().notEmpty(),
    body('line_items').optional().isArray(),
    body('assets_details').optional(),
    body('assetsDetails').optional().isString()
  ];
}

async function update(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const id = Number(req.params.id);
  const cur = await pool.query(`SELECT * FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`, [id]);
  if (!cur.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const body = req.body;
  const line_items = Array.isArray(body.line_items) ? body.line_items : JSON.parse(JSON.stringify(cur.rows[0].line_items || []));

  const vState =
    body.vendor_id != null ? await vendorState(body.vendor_id || cur.rows[0].vendor_id) : await vendorState(cur.rows[0].vendor_id);
  const vendor_id = body.vendor_id ?? cur.rows[0].vendor_id;
  const po_state = body.po_state ?? cur.rows[0].po_state;

  let is_same_state = cur.rows[0].is_same_state;
  if (typeof body.is_same_state === 'boolean') {
    is_same_state = body.is_same_state;
  } else if (po_state || vState) {
    is_same_state = normalizeStateValue(vState) === normalizeStateValue(po_state);
  }

  const sub_total_amount = body.sub_total_amount ?? lineSubtotal(line_items);
  const total_amount = getTotalAmountOfPurchaseOrder(sub_total_amount, !!is_same_state);

  try {
    const upd = await pool.query(
      `UPDATE vendor_purchase_orders SET
        purchase_order_date = COALESCE($1::date, purchase_order_date),
        purchase_order_type = COALESCE(NULLIF($2,''), purchase_order_type),
        vendor_id = COALESCE($3, vendor_id),
        po_state = COALESCE(NULLIF($4,''), po_state),
        is_same_state = $5,
        sub_total_amount = $6,
        total_amount = $7,
        line_items = COALESCE($8::jsonb, line_items),
        assets_details = CASE WHEN $9::jsonb IS NULL THEN assets_details ELSE $9 END,
        remarks = COALESCE($10, remarks),
        status = COALESCE(NULLIF($11,''), status),
        status_updated_by_admin_id = COALESCE($12, status_updated_by_admin_id),
        status_updated_by_name = COALESCE($13, status_updated_by_name),
        updated_at = NOW()
       WHERE po_id = $14 AND deleted_at IS NULL RETURNING *`,
      [
        body.purchase_order_date || null,
        body.purchase_order_type || '',
        body.vendor_id !== undefined && body.vendor_id !== null ? body.vendor_id : null,
        po_state || '',
        is_same_state,
        sub_total_amount,
        total_amount,
        body.line_items != null ? JSON.stringify(line_items) : null,
        body.assets_details != null ? JSON.stringify(body.assets_details) : null,
        body.remarks,
        body.status || '',
        req.user?.user_id || null,
        body.status_updated_by_name || 'Admin',
        id
      ]
    );

    await logVendorAudit({
      actorUserId: req.user?.user_id,
      vendorId: upd.rows[0].vendor_id,
      entityType: 'purchase_order',
      entityId: id,
      action: 'update',
      payload: {}
    });

    res.json({ success: true, data: upd.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
}

const updateValidators = [
  param('id').isInt().toInt(),
  body('status').optional().isString(),
  body('purchase_order_date').optional().isString(),
  body('purchase_order_type').optional().isString(),
  body('vendor_id').optional().isInt().toInt(),
  body('po_state').optional().isString(),
  body('remarks').optional().isString(),
  body('line_items').optional(),
  body('assets_details').optional(),
  body('is_same_state').optional().isBoolean()
];

async function remove(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const r = await pool.query(
    `UPDATE vendor_purchase_orders SET deleted_at = NOW() WHERE po_id = $1 AND deleted_at IS NULL RETURNING *`,
    [req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: r.rows[0].vendor_id,
    entityType: 'purchase_order',
    entityId: req.params.id,
    action: 'soft_delete',
    payload: {}
  });
  res.json({ success: true, message: 'Deleted' });
}

const MANAGER_ROLES = new Set(['manager', 'admin', 'super_admin']);

function isManagerUser(user) {
  if (!user) return false;
  if (user.is_superadmin === true) return true;
  return MANAGER_ROLES.has(String(user.role || '').toLowerCase());
}

/* PO workflow: draft → pending_approval → approved (+ email) | rejected */
const statusValidators = [
  param('id').isInt().toInt(),
  body('status').isIn(['pending_approval', 'approved', 'rejected']),
  body('rejection_reason').optional({ nullable: true }).isString().trim().isLength({ max: 2000 })
];

function normalizeBillFilesJson(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function updateStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const id = Number(req.params.id);
  const { status, rejection_reason: rejectionReason } = req.body;

  const cur = await pool.query(
    `SELECT p.*, v.email AS vendor_email, v.business_name AS vendor_business_name,
            v.first_name AS vendor_first_name, v.phone AS vendor_phone, v.gst_number AS vendor_gst
     FROM vendor_purchase_orders p
     LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
     WHERE p.po_id = $1 AND p.deleted_at IS NULL`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ success: false, message: 'Purchase order not found' });

  const po = cur.rows[0];
  const prev = String(po.status || '').toLowerCase();

  if (status === 'pending_approval') {
    if (!['pending', 'draft', ''].includes(prev)) {
      return res.status(400).json({
        success: false,
        message: 'Only draft purchase orders can be submitted for manager approval.'
      });
    }
    await pool.query(
      `UPDATE vendor_purchase_orders
       SET status = 'pending_approval', submitted_at = NOW(), status_updated_by_admin_id = $1, updated_at = NOW()
       WHERE po_id = $2 AND deleted_at IS NULL`,
      [req.user?.user_id || null, id]
    );

    try {
      await sendPoPendingApprovalEmailToManagers({
        po,
        vendorName: po.vendor_business_name || po.vendor_first_name,
        submitterName: req.user?.name || req.user?.email,
      });
    } catch (emailErr) {
      console.error('PO pending-approval manager email failed:', emailErr);
    }
  } else if (status === 'approved') {
    if (!isManagerUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Only managers can approve purchase orders' });
    }
    if (prev !== 'pending_approval') {
      return res.status(400).json({
        success: false,
        message: 'Purchase order must be in pending approval before a manager can approve it.'
      });
    }

    await pool.query(
      `UPDATE vendor_purchase_orders
       SET status = 'approved', approved_at = NOW(), sent_to_vendor_at = NOW(),
           status_updated_by_admin_id = $1, rejection_reason = NULL, updated_at = NOW()
       WHERE po_id = $2 AND deleted_at IS NULL`,
      [req.user?.user_id || null, id]
    );

    try {
      const vendor = {
        email: po.vendor_email,
        business_name: po.vendor_business_name,
        first_name: po.vendor_first_name
      };
      const { absolutePath } = await generatePurchaseOrderPdf({ po, vendor });
      await sendPurchaseOrderApprovedEmail({ po, vendor, pdfAbsolutePath: absolutePath });
    } catch (emailErr) {
      console.error('PO approval email failed:', emailErr);
    }
  } else if (status === 'rejected') {
    if (!isManagerUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Only managers can reject purchase orders' });
    }
    if (prev !== 'pending_approval') {
      return res.status(400).json({
        success: false,
        message: 'Purchase order must be in pending approval before it can be rejected.'
      });
    }
    const reason = String(rejectionReason || '').trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }
    await pool.query(
      `UPDATE vendor_purchase_orders
       SET status = 'rejected', rejection_reason = $1, status_updated_by_admin_id = $2, updated_at = NOW()
       WHERE po_id = $3 AND deleted_at IS NULL`,
      [reason, req.user?.user_id || null, id]
    );
  }

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: po.vendor_id || null,
    entityType: 'purchase_order',
    entityId: id,
    action: 'status_change',
    payload: { from: prev, to: status, rejection_reason: rejectionReason || null }
  });

  res.json({ success: true, message: 'Purchase order status updated!', data: { po_id: id, status } });
}

const grnBillParamValidators = [param('poId').isInt().toInt(), param('grnId').isInt().toInt()];

function createGrnBillsUpload() {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(
          __dirname,
          '..',
          '..',
          'uploads',
          'vendor-grn-bills',
          String(req.params.poId),
          String(req.params.grnId)
        );
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const safe = String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${safe}`);
      }
    }),
    limits: multerLimits()
  });
}

async function uploadGrnBill(req, res) {
  try {
    const poId = Number(req.params.poId);
    const grnId = Number(req.params.grnId);
    const bill_name = String(req.body.bill_name || '').trim();
    if (!bill_name) return res.status(400).json({ success: false, message: 'Bill number is required' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, message: 'At least one file is required' });

    const cur = await pool.query(
      `SELECT grn_id, bill_files FROM vendor_goods_received_notes
       WHERE grn_id = $1 AND po_id = $2 AND deleted_at IS NULL`,
      [grnId, poId]
    );
    if (!cur.rows.length) return res.status(404).json({ success: false, message: 'GRN not found' });

    let existing = cur.rows[0].bill_files;
    if (existing != null && typeof existing === 'string') {
      try {
        existing = JSON.parse(existing);
      } catch {
        existing = [];
      }
    }
    if (!Array.isArray(existing)) existing = [];

    const newPaths = files.map(
      (f) => `/uploads/vendor-grn-bills/${poId}/${grnId}/${f.filename}`
    );
    const merged = [...existing, ...newPaths];

    await pool.query(
      `UPDATE vendor_goods_received_notes
       SET bill_name = $1, bill_files = $2::jsonb, bill_status = 'received', updated_at = NOW()
       WHERE grn_id = $3`,
      [bill_name, JSON.stringify(merged), grnId]
    );

    await syncPoBillFromGrn(poId, bill_name, merged);

    res.json({
      success: true,
      message: 'GRN bill uploaded successfully',
      data: { bill_name, bill_files: merged, bill_status: 'received' }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || 'Upload failed' });
  }
}

function createBillsUpload() {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', '..', 'uploads', 'vendor-po-bills', String(req.params.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const safe = String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${safe}`);
      }
    }),
    limits: multerLimits()
  });
}

async function uploadBills(req, res) {
  try {
    const id = Number(req.params.id);
    const bill_name = String(req.body.bill_name || '').trim();
    if (!bill_name) return res.status(400).json({ success: false, message: 'Bill number is required' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, message: 'At least one file is required' });

    const cur = await pool.query(`SELECT bill_files FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`, [
      id
    ]);
    if (!cur.rows.length) return res.status(404).json({ success: false, message: 'Purchase order not found' });

    let existing = cur.rows[0].bill_files;
    if (existing != null && typeof existing === 'string') {
      try {
        existing = JSON.parse(existing);
      } catch {
        existing = [];
      }
    }
    if (!Array.isArray(existing)) existing = [];

    const newPaths = files.map((f) => `/uploads/vendor-po-bills/${id}/${f.filename}`);
    const merged = [...existing, ...newPaths];

    await pool.query(
      `UPDATE vendor_purchase_orders SET bill_name = $1, bill_files = $2::jsonb, updated_at = NOW()
       WHERE po_id = $3 AND deleted_at IS NULL`,
      [bill_name, JSON.stringify(merged), id]
    );

    await logVendorAudit({
      actorUserId: req.user?.user_id,
      vendorId: null,
      entityType: 'purchase_order',
      entityId: id,
      action: 'bill_upload',
      payload: { bill_name, files_count: files.length }
    });

    res.json({
      success: true,
      message: 'Bill / invoice uploaded successfully.',
      bill_name,
      bill_files: merged
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || 'Upload failed' });
  }
}

module.exports = {
  listValidators,
  list,
  nextNumber,
  formMeta,
  productReceivedValidators,
  getProductReceivedContext,
  receiveSerialValidators,
  receiveProductSerial,
  receivePoLineBulkValidators,
  receivePoLineBulk,
  receivePoLineUnitValidators,
  receivePoLineUnit,
  generatedGrnValidators,
  getGeneratedGrnOverview,
  grnReceivedProductsValidators,
  getGrnReceivedProducts,
  getValidators,
  getOne,
  getByNumber,
  createValidators,
  create,
  updateValidators,
  update,
  remove,
  statusValidators,
  updateStatus,
  createBillsUpload,
  uploadBills,
  grnBillParamValidators,
  createGrnBillsUpload,
  uploadGrnBill
};
