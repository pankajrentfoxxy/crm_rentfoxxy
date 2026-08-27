/**
 * Guard Gate Movement Validation.
 *
 * A read/validate layer over existing GRN, DC, Return DC, Support pickup,
 * Vendor Repair DC, and AWB records. Does NOT call inventoryStateMachine and
 * does not change inventory_status — existing modules remain the source of truth.
 */
const pool = require('../config/db');
const { logTtsplEvent } = require('./ttsplAuditService');
const { formatTtspl, parseTtsplNum } = require('./vendorInventoryAssetCodeService');
const { parseGateQrPayload, lookupToken } = require('./gateQrService');

const DIRECTIONS = new Set(['inward', 'outward']);
const CANCELLED_DC = new Set(['cancelled']);

function normalizeScan(raw) {
  return String(raw || '').trim();
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

function normalizeTtspl(raw) {
  const code = normalizeCode(raw).replace(/[\s\-_]/g, '');
  if (!code) return '';
  const parsed = parseTtsplNum(code);
  if (parsed != null) return formatTtspl(parsed);
  const flex = code.match(/^T+SPL(\d+)$/i);
  if (flex) {
    const num = Number(flex[1]);
    if (Number.isFinite(num) && num > 0) return formatTtspl(num);
  }
  return code;
}

function formatConfig(extra) {
  const x = extra && typeof extra === 'object' ? extra : {};
  return [
    x.brand || x.brand_name,
    x.model || x.model_name,
    x.processor,
    x.generation,
    x.ram,
    x.storage,
  ].filter(Boolean).join(' / ') || null;
}

function parseJson(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function unitsFromSerialJson(raw) {
  const arr = parseJson(raw, null);
  const entries = Array.isArray(arr) ? arr : (raw ? [raw] : []);
  const out = [];
  for (const e of entries) {
    const parts = String(e).split('|');
    const serialId = /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
    out.push({
      serial_id: serialId,
      serial_number: parts[1] || (serialId ? null : parts[0]) || null,
      ttspl: parts[2] || null,
    });
  }
  return out;
}

function parseGrnId(raw) {
  const m = String(raw || '').trim().match(/GRN[-/]?0*(\d+)/i);
  if (m) return Number(m[1]);
  const fy = String(raw || '').trim().match(/GRN\/\d{2}-\d{2}\/0*(\d+)/i);
  return fy ? Number(fy[1]) : null;
}

function classifyDocumentNumber(raw) {
  const original = String(raw || '').trim();
  if (!original) return null;
  const n = original.toUpperCase();
  if (/^VRDC\/.+-R\d+$/i.test(n) || /^VRDC\/.+-REP\d+$/i.test(n)) {
    return { docType: 'vrdc', docNumber: original, variant: 'receive' };
  }
  if (/^VRDC/i.test(n)) return { docType: 'vrdc', docNumber: original };
  if (/^RDC/i.test(n)) return { docType: 'rdc', docNumber: original };
  if (/^SDC/i.test(n)) return { docType: 'sdc', docNumber: original };
  if (/^GRN/i.test(n)) return { docType: 'grn', docNumber: original };
  if (/^(G?DC)[\/-]/i.test(n) || /^G?DC-\d/i.test(n)) {
    return { docType: 'dc', docNumber: original };
  }
  return null;
}

function looksLikeAwb(raw) {
  const s = String(raw || '').trim();
  if (s.length < 8) return false;
  if (/\s/.test(s)) return false;
  if (/^TTSPL/i.test(s)) return false;
  if (classifyDocumentNumber(s)) return false;
  return /^[A-Z0-9-]{8,32}$/i.test(s);
}

async function getActor(db, user) {
  const userId = user?.user_id || user?.id || null;
  if (!userId) return { userId: null, name: user?.name || null };
  const r = await db.query(`SELECT user_id, name FROM users WHERE user_id = $1`, [userId]);
  return { userId, name: r.rows[0]?.name || user?.name || user?.email || 'Guard' };
}

function laptopDto(row, extra = {}) {
  return {
    serial_id: row.serial_id || null,
    ttspl: row.ttspl || row.inventory_asset_code || row.ttspl_id || extra.ttspl || null,
    serial_number: row.serial_number || extra.serial_number || null,
    configuration: row.configuration || formatConfig(parseJson(row.extra, {})) || extra.configuration || null,
    inventory_status: row.inventory_status || extra.inventory_status || null,
    scanned: Boolean(extra.scanned),
    scan_result: extra.scan_result || null,
  };
}

function publicMovement(ctx) {
  if (!ctx) return null;
  return {
    direction: ctx.direction,
    source_type: ctx.source_type,
    source_label: ctx.source_label,
    reference_type: ctx.reference_type,
    reference_number: ctx.reference_number,
    party_name: ctx.party_name || null,
    so_number: ctx.so_number || null,
    awb_number: ctx.awb_number || null,
    expected_count: ctx.laptops?.length || 0,
    allow_partial: Boolean(ctx.allow_partial),
    active: ctx.active !== false,
    inactive_reason: ctx.inactive_reason || null,
  };
}

async function findSerial(db, raw) {
  const original = normalizeScan(raw);
  if (!original) return null;
  const ttspl = normalizeTtspl(original);
  const r = await db.query(
    `SELECT serial_id, serial_number, inventory_status, qc_status, grn_id,
            current_dc_number, current_customer_id,
            COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl,
            extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (
          inventory_asset_code = $1
          OR inventory_asset_code = $2
          OR serial_number ILIKE $3
          OR extra->>'ttspl_id' = $1
          OR extra->>'ttspl_id' = $2
        )
      ORDER BY CASE
        WHEN inventory_asset_code = $2 THEN 0
        WHEN inventory_asset_code = $1 THEN 1
        WHEN serial_number ILIKE $3 THEN 2
        ELSE 3
      END
      LIMIT 1`,
    [original, ttspl || original, original]
  );
  return r.rows[0] || null;
}

async function enrichLaptops(db, units) {
  const ids = [...new Set(units.map((u) => u.serial_id).filter(Boolean))];
  const codes = [...new Set(units.flatMap((u) => [u.ttspl, u.serial_number].filter(Boolean)))];
  let byId = new Map();
  if (ids.length) {
    const r = await db.query(
      `SELECT serial_id, serial_number, inventory_status, qc_status, extra,
              COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND serial_id = ANY($1::int[])`,
      [ids]
    );
    byId = new Map(r.rows.map((row) => [row.serial_id, row]));
  }
  let byCode = new Map();
  if (codes.length) {
    const r = await db.query(
      `SELECT serial_id, serial_number, inventory_status, qc_status, extra,
              COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (
            inventory_asset_code = ANY($1::text[])
            OR serial_number = ANY($1::text[])
            OR extra->>'ttspl_id' = ANY($1::text[])
          )`,
      [codes]
    );
    for (const row of r.rows) {
      byCode.set(String(row.ttspl || '').toUpperCase(), row);
      byCode.set(String(row.serial_number || '').toUpperCase(), row);
    }
  }
  return units.map((u) => {
    const hit = (u.serial_id && byId.get(u.serial_id))
      || byCode.get(normalizeCode(u.ttspl))
      || byCode.get(normalizeCode(u.serial_number))
      || {};
    return laptopDto({ ...hit, ...u, extra: hit.extra || u.extra });
  }).filter((l) => l.ttspl || l.serial_number || l.serial_id);
}

function uniqueLaptops(list) {
  const seen = new Set();
  const out = [];
  for (const l of list) {
    const key = l.serial_id ? `id:${l.serial_id}` : `c:${normalizeCode(l.ttspl || l.serial_number)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

async function loadOutboundDc(db, dcNumber) {
  const r = await db.query(
    `SELECT dc_number, sales_order_number, customer_name, status, dc_purpose,
            movement_type, awb_number, porter_tracking_id, ship_by, dispatch_mode,
            serial_number, warehouse_received_at
       FROM delivery_challan_lines
      WHERE dc_number = $1
        AND COALESCE(movement_type, 'outbound') <> 'return'
      ORDER BY id ASC`,
    [dcNumber]
  );
  if (!r.rows.length) return null;
  const head = r.rows[0];
  const statuses = [...new Set(r.rows.map((row) => String(row.status || '').toLowerCase()))];
  const cancelled = statuses.every((s) => CANCELLED_DC.has(s));
  const delivered = statuses.every((s) => s === 'delivered');
  const rejected = statuses.every((s) => s === 'rejected');
  const purpose = String(head.dc_purpose || '').toLowerCase();
  let source_type = 'customer_delivery';
  let source_label = 'Customer Delivery';
  if (purpose === 'replacement') {
    source_type = 'replacement';
    source_label = 'Replacement';
  } else if (purpose === 'service_return') {
    source_type = 'service_return';
    source_label = 'Service Return';
  }

  const sos = await db.query(
    `SELECT serial_id, ttspl_id AS ttspl, serial_number, status
       FROM sales_order_serials
      WHERE dc_number = $1 AND status <> 'removed'`,
    [dcNumber]
  );
  let units = sos.rows.map((row) => ({
    serial_id: row.serial_id,
    ttspl: row.ttspl,
    serial_number: row.serial_number,
  }));
  if (!units.length) {
    units = r.rows.flatMap((row) => unitsFromSerialJson(row.serial_number));
  }
  const laptops = uniqueLaptops(await enrichLaptops(db, units));
  const awb = r.rows.map((row) => row.awb_number).filter(Boolean)[0]
    || r.rows.map((row) => row.porter_tracking_id).filter(Boolean)[0]
    || null;

  let active = true;
  let inactive_reason = null;
  if (cancelled) {
    active = false;
    inactive_reason = 'This delivery challan is cancelled.';
  } else if (delivered) {
    active = false;
    inactive_reason = 'This delivery challan is already delivered.';
  } else if (rejected) {
    active = false;
    inactive_reason = 'This delivery challan was rejected.';
  }

  return {
    direction: 'outward',
    source_type,
    source_label,
    reference_type: 'dc',
    reference_number: head.dc_number,
    party_name: head.customer_name || null,
    so_number: head.sales_order_number || null,
    awb_number: awb,
    allow_partial: false,
    active,
    inactive_reason,
    laptops,
    statuses,
  };
}

async function loadReturnDc(db, rdcNumber) {
  const r = await db.query(
    `SELECT dc_number, sales_order_number, customer_name, status, dc_purpose,
            movement_type, awb_number, porter_tracking_id, serial_number,
            warehouse_received_at, support_ticket_id
       FROM delivery_challan_lines
      WHERE dc_number = $1
        AND movement_type = 'return'
      ORDER BY id ASC`,
    [rdcNumber]
  );
  if (!r.rows.length) return null;
  const head = r.rows[0];
  const items = await db.query(
    `SELECT id, ttspl_id, serial_number, unique_serial_number, pickup_type,
            warehouse_received_at, pickup_awb, pickup_courier_name,
            return_dc_number
       FROM support_ticket_items
      WHERE return_dc_number = $1
         OR (ticket_id = $2 AND $2 IS NOT NULL AND item_type = 'pickup')
      ORDER BY id ASC`,
    [rdcNumber, head.support_ticket_id]
  );
  const pickupType = items.rows.find((i) => i.pickup_type)?.pickup_type;
  const source_type = pickupType === 'repair' ? 'repair_pickup' : 'customer_return';
  const source_label = pickupType === 'repair' ? 'Repair Pickup' : 'Customer Return';

  let units = items.rows.map((row) => ({
    ttspl: row.ttspl_id || row.unique_serial_number,
    serial_number: row.serial_number,
  }));
  if (!units.length) {
    units = r.rows.flatMap((row) => unitsFromSerialJson(row.serial_number));
  }
  const laptops = uniqueLaptops(await enrichLaptops(db, units));
  const warehouseReceived = items.rows.length
    ? items.rows.every((i) => i.warehouse_received_at)
    : r.rows.every((row) => row.warehouse_received_at);
  const cancelled = r.rows.every((row) => CANCELLED_DC.has(String(row.status || '').toLowerCase()));

  let active = true;
  let inactive_reason = null;
  if (cancelled) {
    active = false;
    inactive_reason = 'This return DC is cancelled.';
  } else if (warehouseReceived) {
    active = false;
    inactive_reason = 'This return has already been received at the warehouse.';
  }

  return {
    direction: 'inward',
    source_type,
    source_label,
    reference_type: 'rdc',
    reference_number: head.dc_number,
    party_name: head.customer_name || null,
    so_number: head.sales_order_number || null,
    awb_number: head.awb_number || items.rows.map((i) => i.pickup_awb).filter(Boolean)[0] || null,
    allow_partial: false,
    active,
    inactive_reason,
    laptops,
  };
}

async function loadServiceDc(db, sdcNumber) {
  const r = await db.query(
    `SELECT dc_number, sales_order_number, customer_name, status, dc_purpose,
            movement_type, awb_number, serial_number
       FROM delivery_challan_lines
      WHERE dc_number = $1
        AND dc_purpose = 'service_return'
      ORDER BY id ASC`,
    [sdcNumber]
  );
  if (!r.rows.length) return null;
  const ctx = await loadOutboundDc(db, sdcNumber);
  if (!ctx) return null;
  ctx.source_type = 'service_return';
  ctx.source_label = 'Service Return';
  ctx.reference_type = 'sdc';
  return ctx;
}

async function loadVendorRepairDc(db, dcNumber, preferredDirection) {
  const headRes = await db.query(
    `SELECT dc_number, vendor_id, vendor_name, status, awb_number, porter_tracking_id
       FROM vendor_repair_delivery_challans
      WHERE dc_number = $1
         OR receive_dc_number = $1
      LIMIT 1`,
    [dcNumber]
  );
  if (!headRes.rows.length) return null;
  const head = headRes.rows[0];
  const items = await db.query(
    `SELECT id, serial_id, ttspl_id, serial_number, configuration, item_status,
            receive_dc_number, replacement_dc_number
       FROM vendor_repair_dc_items
      WHERE dc_number = $1
      ORDER BY id ASC`,
    [head.dc_number]
  );
  const dcStatus = String(head.status || '').toLowerCase();
  const scannedIsReceive = /-(R|REP)\d+$/i.test(String(dcNumber));
  const direction = scannedIsReceive
    ? 'inward'
    : (preferredDirection === 'inward' ? 'inward' : 'outward');

  const outwardItems = items.rows.filter((i) => {
    const s = String(i.item_status || 'draft').toLowerCase();
    return !['received', 'replacement_received'].includes(s);
  });
  const inwardItems = items.rows.filter((i) => {
    const s = String(i.item_status || '').toLowerCase();
    return s === 'dispatched' || s === 'out_for_repair';
  });

  const pick = direction === 'inward' ? (inwardItems.length ? inwardItems : items.rows) : outwardItems;
  const units = pick.map((row) => ({
    serial_id: row.serial_id,
    ttspl: row.ttspl_id,
    serial_number: row.serial_number,
    configuration: row.configuration,
  }));
  const laptops = uniqueLaptops(await enrichLaptops(db, units));

  let active = true;
  let inactive_reason = null;
  if (direction === 'outward') {
    if (dcStatus === 'returned' || dcStatus === 'cancelled') {
      active = false;
      inactive_reason = 'This vendor repair DC is no longer open for outward.';
    }
  } else if (dcStatus === 'cancelled') {
    active = false;
    inactive_reason = 'This vendor repair DC is cancelled.';
  } else if (dcStatus === 'returned' && inwardItems.length === 0) {
    active = false;
    inactive_reason = 'All units on this vendor repair DC have already been received.';
  }

  return {
    direction,
    source_type: 'vendor_repair',
    source_label: direction === 'inward' ? 'Vendor Repair Return' : 'Vendor Repair',
    reference_type: 'vrdc',
    reference_number: head.dc_number,
    party_name: head.vendor_name || null,
    so_number: null,
    awb_number: head.awb_number || head.porter_tracking_id || null,
    allow_partial: direction === 'inward',
    active,
    inactive_reason,
    laptops,
  };
}

async function loadGrn(db, rawNumber) {
  const grnId = parseGrnId(rawNumber);
  let row;
  if (grnId) {
    const r = await db.query(
      `SELECT g.grn_id, g.po_id, g.bill_name,
              ('GRN-' || LPAD(g.grn_id::text, 4, '0')) AS grn_number,
              COALESCE(v.business_name, TRIM(CONCAT(v.first_name, ' ', v.last_name))) AS vendor_name
         FROM vendor_goods_received_notes g
         LEFT JOIN vendor_purchase_orders po ON po.po_id = g.po_id
         LEFT JOIN vendors v ON v.vendor_id = po.vendor_id AND v.deleted_at IS NULL
        WHERE g.grn_id = $1
        LIMIT 1`,
      [grnId]
    );
    row = r.rows[0];
  }
  if (!row) {
    const r = await db.query(
      `SELECT g.grn_id, g.po_id, g.bill_name,
              ('GRN-' || LPAD(g.grn_id::text, 4, '0')) AS grn_number,
              COALESCE(v.business_name, TRIM(CONCAT(v.first_name, ' ', v.last_name))) AS vendor_name
         FROM vendor_goods_received_notes g
         LEFT JOIN vendor_purchase_orders po ON po.po_id = g.po_id
         LEFT JOIN vendors v ON v.vendor_id = po.vendor_id AND v.deleted_at IS NULL
        WHERE g.bill_name ILIKE $1
        LIMIT 1`,
      [String(rawNumber).trim()]
    );
    row = r.rows[0];
  }
  if (!row) return null;

  const serials = await db.query(
    `SELECT serial_id, serial_number, inventory_status, extra,
            COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND grn_id = $1
      ORDER BY serial_id ASC`,
    [row.grn_id]
  );
  const laptops = serials.rows.map((s) => laptopDto(s));
  return {
    direction: 'inward',
    source_type: 'vendor',
    source_label: 'Vendor',
    reference_type: 'grn',
    reference_number: row.grn_number,
    party_name: row.vendor_name || null,
    so_number: null,
    awb_number: null,
    allow_partial: true,
    active: laptops.length > 0,
    inactive_reason: laptops.length ? null : 'No laptops are recorded on this GRN.',
    laptops,
    grn_id: row.grn_id,
  };
}

async function loadDocument(db, docType, docNumber, preferredDirection) {
  if (docType === 'dc') return loadOutboundDc(db, docNumber);
  if (docType === 'rdc') return loadReturnDc(db, docNumber);
  if (docType === 'sdc') return loadServiceDc(db, docNumber);
  if (docType === 'vrdc') return loadVendorRepairDc(db, docNumber, preferredDirection);
  if (docType === 'grn') return loadGrn(db, docNumber);
  return null;
}

async function findByAwb(db, awb, preferredDirection) {
  const token = String(awb || '').trim();
  if (token.length < 8) return null;

  const dcRes = await db.query(
    `SELECT dc_number, movement_type, dc_purpose, awb_number, porter_tracking_id
       FROM delivery_challan_lines
      WHERE awb_number ILIKE '%' || $1 || '%'
         OR porter_tracking_id ILIKE '%' || $1 || '%'
      ORDER BY id DESC
      LIMIT 8`,
    [token]
  );
  let dcNumber = dcRes.rows[0]?.dc_number || null;
  let movementType = dcRes.rows[0]?.movement_type;
  let purpose = dcRes.rows[0]?.dc_purpose;

  if (!dcNumber) {
    try {
      const ship = await db.query(
        `SELECT dc_number, awb_number FROM dc_shipment_units
          WHERE awb_number ILIKE '%' || $1 || '%'
          ORDER BY id DESC LIMIT 1`,
        [token]
      );
      dcNumber = ship.rows[0]?.dc_number || null;
    } catch (_) { /* table may not exist on very old DBs */ }
  }

  if (dcNumber) {
    if (!movementType) {
      const head = await db.query(
        `SELECT movement_type, dc_purpose FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
        [dcNumber]
      );
      movementType = head.rows[0]?.movement_type;
      purpose = head.rows[0]?.dc_purpose;
    }
    const isReturn = String(movementType || '') === 'return';
    const isService = String(purpose || '') === 'service_return';
    const ctx = isReturn
      ? await loadReturnDc(db, dcNumber)
      : isService
        ? await loadServiceDc(db, dcNumber)
        : await loadOutboundDc(db, dcNumber);
    if (ctx) {
      ctx.awb_number = ctx.awb_number || token;
      if (preferredDirection && ctx.direction !== preferredDirection) {
        return invalidCtx(`This AWB is expected as ${ctx.direction.toUpperCase()}, not ${preferredDirection.toUpperCase()}.`);
      }
      return ctx;
    }
  }

  const vrdc = await db.query(
    `SELECT dc_number, awb_number, porter_tracking_id, status
       FROM vendor_repair_delivery_challans
      WHERE awb_number ILIKE '%' || $1 || '%'
         OR porter_tracking_id ILIKE '%' || $1 || '%'
      ORDER BY id DESC LIMIT 1`,
    [token]
  );
  if (vrdc.rows[0]) {
    const ctx = await loadVendorRepairDc(db, vrdc.rows[0].dc_number, preferredDirection);
    if (ctx) {
      ctx.awb_number = ctx.awb_number || token;
      return ctx;
    }
  }

  const pickup = await db.query(
    `SELECT return_dc_number, pickup_awb, pickup_type, ticket_id
       FROM support_ticket_items
      WHERE pickup_awb ILIKE '%' || $1 || '%'
      ORDER BY id DESC LIMIT 1`,
    [token]
  );
  if (pickup.rows[0]?.return_dc_number) {
    const ctx = await loadReturnDc(db, pickup.rows[0].return_dc_number);
    if (ctx) {
      ctx.awb_number = ctx.awb_number || token;
      if (preferredDirection && ctx.direction !== preferredDirection) {
        return invalidCtx(`This AWB is expected as ${ctx.direction.toUpperCase()}, not ${preferredDirection.toUpperCase()}.`);
      }
      return ctx;
    }
  }

  return null;
}

function invalidCtx(message) {
  return { invalid: true, message };
}

async function findBySerial(db, serial, preferredDirection) {
  const candidates = [];

  const sos = await db.query(
    `SELECT sos.dc_number, sos.status, d.movement_type, d.dc_purpose, d.status AS dc_status
       FROM sales_order_serials sos
       JOIN delivery_challan_lines d ON d.dc_number = sos.dc_number
      WHERE sos.serial_id = $1
        AND sos.status <> 'removed'
        AND COALESCE(d.movement_type, 'outbound') <> 'return'
        AND LOWER(COALESCE(d.status, '')) NOT IN ('cancelled')
      ORDER BY sos.updated_at DESC NULLS LAST
      LIMIT 5`,
    [serial.serial_id]
  );
  for (const row of sos.rows) {
    const ctx = String(row.dc_purpose || '') === 'service_return'
      ? await loadServiceDc(db, row.dc_number)
      : await loadOutboundDc(db, row.dc_number);
    if (ctx) candidates.push(ctx);
  }

  if (serial.current_dc_number) {
    const already = candidates.some((c) => c.reference_number === serial.current_dc_number);
    if (!already) {
      const ctx = await loadOutboundDc(db, serial.current_dc_number)
        || await loadReturnDc(db, serial.current_dc_number)
        || await loadServiceDc(db, serial.current_dc_number);
      if (ctx) candidates.push(ctx);
    }
  }

  const rdc = await db.query(
    `SELECT DISTINCT COALESCE(sti.return_dc_number, d.dc_number) AS rdc_number
       FROM support_ticket_items sti
       LEFT JOIN delivery_challan_lines d
         ON d.support_ticket_id = sti.ticket_id AND d.movement_type = 'return'
      WHERE sti.item_type = 'pickup'
        AND sti.warehouse_received_at IS NULL
        AND (
          sti.ttspl_id = $1 OR sti.serial_number = $2 OR sti.unique_serial_number = $1
        )
      LIMIT 5`,
    [serial.ttspl, serial.serial_number]
  );
  for (const row of rdc.rows) {
    if (!row.rdc_number) continue;
    const ctx = await loadReturnDc(db, row.rdc_number);
    if (ctx) candidates.push(ctx);
  }

  const vrdc = await db.query(
    `SELECT i.dc_number, i.item_status, d.status
       FROM vendor_repair_dc_items i
       JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number
      WHERE (i.serial_id = $1 OR i.ttspl_id = $2 OR i.serial_number = $3)
        AND d.status NOT IN ('cancelled')
      ORDER BY i.id DESC
      LIMIT 3`,
    [serial.serial_id, serial.ttspl, serial.serial_number]
  );
  for (const row of vrdc.rows) {
    const itemStatus = String(row.item_status || '').toLowerCase();
    const pref = ['received', 'replacement_received'].includes(itemStatus)
      ? null
      : (itemStatus === 'dispatched' ? 'inward' : 'outward');
    const ctx = await loadVendorRepairDc(db, row.dc_number, preferredDirection || pref);
    if (ctx) candidates.push(ctx);
  }

  if (serial.grn_id) {
    const alreadyInward = await confirmedAlready(db, {
      direction: 'inward',
      referenceType: 'grn',
      referenceNumber: `GRN-${String(serial.grn_id).padStart(4, '0')}`,
      serialId: serial.serial_id,
    });
    const leftWarehouse = ['reserved', 'in_transit', 'rented', 'on_demo', 'sold', 'scrapped']
      .includes(String(serial.inventory_status || ''));
    const alreadyOnShelf = String(serial.qc_status || '') === 'passed' && String(serial.inventory_status || '') === 'in_stock';
    if (!alreadyInward && !leftWarehouse && !alreadyOnShelf) {
      const ctx = await loadGrn(db, `GRN-${serial.grn_id}`);
      if (ctx) candidates.push(ctx);
    }
  }

  const refusedParams = [serial.ttspl || '___none___', serial.serial_number || '___none___'];
  let refusedSql = `
    SELECT dc_number FROM delivery_challan_lines
     WHERE LOWER(status) = 'rejected'
       AND warehouse_received_at IS NULL
       AND (
         serial_number::text ILIKE '%' || $1 || '%'
         OR serial_number::text ILIKE '%' || $2 || '%'
  `;
  if (serial.current_dc_number) {
    refusedParams.push(serial.current_dc_number);
    refusedSql += ` OR dc_number = $3`;
  }
  refusedSql += `) LIMIT 1`;
  const refused = await db.query(refusedSql, refusedParams);
  if (refused.rows[0]) {
    const ctx = await loadOutboundDc(db, refused.rows[0].dc_number);
    if (ctx) {
      ctx.direction = 'inward';
      ctx.source_type = 'refused_delivery';
      ctx.source_label = 'Refused Delivery';
      ctx.active = true;
      ctx.inactive_reason = null;
      candidates.push(ctx);
    }
  }

  const filtered = candidates.filter(Boolean);
  if (!filtered.length) return null;

  const dirMatch = preferredDirection
    ? filtered.filter((c) => c.direction === preferredDirection && c.active)
    : filtered.filter((c) => c.active);
  const poolList = dirMatch.length ? dirMatch : (preferredDirection
    ? filtered.filter((c) => c.direction === preferredDirection)
    : filtered);
  return poolList[0] || filtered[0];
}

function laptopMatches(laptop, serial) {
  if (laptop.serial_id && serial.serial_id && Number(laptop.serial_id) === Number(serial.serial_id)) {
    return true;
  }
  const a = normalizeCode(laptop.ttspl);
  const b = normalizeTtspl(serial.ttspl || '');
  if (a && b && a === b) return true;
  const snA = normalizeCode(laptop.serial_number);
  const snB = normalizeCode(serial.serial_number);
  return Boolean(snA && snB && snA === snB);
}

async function confirmedAlready(db, { direction, referenceType, referenceNumber, serialId }) {
  if (!serialId) return false;
  const r = await db.query(
    `SELECT 1 FROM gate_movements
      WHERE direction = $1
        AND reference_type = $2
        AND reference_number = $3
        AND serial_id = $4
        AND validation_result = 'valid'
        AND confirmed_at IS NOT NULL
      LIMIT 1`,
    [direction, referenceType, referenceNumber, serialId]
  );
  return r.rows.length > 0;
}

async function scannedInSession(db, sessionId, serialId) {
  if (!serialId) return false;
  const r = await db.query(
    `SELECT 1 FROM gate_movements
      WHERE session_id = $1
        AND serial_id = $2
        AND validation_result = 'valid'
      LIMIT 1`,
    [sessionId, serialId]
  );
  return r.rows.length > 0;
}

async function attachScanState(db, session, laptops) {
  const scans = await db.query(
    `SELECT serial_id, ttspl, serial_number, validation_result, scan_time, confirmed_at
       FROM gate_movements
      WHERE session_id = $1
         OR (
           direction = $2
           AND reference_type = $3
           AND reference_number = $4
           AND validation_result = 'valid'
           AND confirmed_at IS NOT NULL
         )
      ORDER BY scan_time ASC`,
    [session.session_id, session.direction, session.reference_type, session.reference_number]
  );
  const validById = new Map();
  for (const s of scans.rows) {
    if (s.validation_result !== 'valid') continue;
    if (s.serial_id) validById.set(Number(s.serial_id), s);
  }
  return laptops.map((l) => {
    const hit = l.serial_id ? validById.get(Number(l.serial_id)) : null;
    return {
      ...l,
      scanned: Boolean(hit),
      scan_result: hit ? 'valid' : null,
      scanned_at: hit?.scan_time || null,
    };
  });
}

async function openOrReuseSession(db, ctx, actor) {
  const existing = await db.query(
    `SELECT * FROM gate_scan_sessions
      WHERE direction = $1
        AND reference_type = $2
        AND reference_number = $3
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1`,
    [ctx.direction, ctx.reference_type, ctx.reference_number]
  );
  if (existing.rows[0]) return existing.rows[0];

  const ins = await db.query(
    `INSERT INTO gate_scan_sessions (
        direction, source_type, reference_type, reference_number, awb_number,
        expected_count, allow_partial, status, guard_user_id, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9::jsonb)
     RETURNING *`,
    [
      ctx.direction,
      ctx.source_type,
      ctx.reference_type,
      ctx.reference_number,
      ctx.awb_number || null,
      ctx.laptops.length,
      Boolean(ctx.allow_partial),
      actor.userId,
      JSON.stringify({
        source_label: ctx.source_label,
        party_name: ctx.party_name,
        so_number: ctx.so_number,
      }),
    ]
  );
  return ins.rows[0];
}

async function sessionView(db, session, ctx) {
  const laptops = await attachScanState(db, session, ctx.laptops || []);
  const scannedCount = laptops.filter((l) => l.scanned).length;
  const pending = await db.query(
    `SELECT COUNT(*)::int AS n FROM gate_movements
      WHERE session_id = $1 AND validation_result = 'valid' AND confirmed_at IS NULL`,
    [session.session_id]
  );
  const pendingCount = pending.rows[0]?.n || 0;
  const complete = scannedCount === laptops.length || (session.allow_partial && pendingCount > 0);
  return {
    session_id: session.session_id,
    status: session.status,
    allow_partial: session.allow_partial,
    expected_count: laptops.length,
    scanned_count: scannedCount,
    remaining_count: Math.max(0, laptops.length - scannedCount),
    movement: publicMovement({ ...ctx, laptops }),
    laptops,
    can_confirm: session.status === 'open'
      && ctx.active !== false
      && pendingCount > 0
      && complete,
  };
}

async function recordMovement(db, {
  session, ctx, serial, result, message, actor, awb,
}) {
  const ins = await db.query(
    `INSERT INTO gate_movements (
        session_id, direction, source_type, reference_type, reference_number,
        serial_id, ttspl, serial_number, awb_number,
        guard_user_id, guard_name, validation_result, validation_message, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     RETURNING *`,
    [
      session?.session_id || null,
      ctx.direction,
      ctx.source_type,
      ctx.reference_type,
      ctx.reference_number,
      serial?.serial_id || null,
      serial?.ttspl || null,
      serial?.serial_number || null,
      awb || ctx.awb_number || null,
      actor.userId,
      actor.name,
      result,
      message || null,
      JSON.stringify({
        inventory_status: serial?.inventory_status || null,
        configuration: formatConfig(parseJson(serial?.extra, {})),
      }),
    ]
  );
  return ins.rows[0];
}

function directionMismatch(ctx, requested) {
  if (!requested || !ctx?.direction) return null;
  if (ctx.direction === requested) return null;
  return `This movement is expected as ${ctx.direction.toUpperCase()}, not ${requested.toUpperCase()}.`;
}

async function resolveDocumentContext(db, scan, preferredDirection) {
  const qr = parseGateQrPayload(scan);
  if (qr) {
    const tok = await lookupToken(db, qr.token);
    if (!tok) {
      return { error: 'This QR is not recognised. Use a document printed from the CRM.' };
    }
    if (qr.docNumber && tok.document_number !== qr.docNumber) {
      return { error: 'This QR does not match a valid gate document.' };
    }
    const ctx = await loadDocument(db, tok.document_type, tok.document_number, preferredDirection);
    if (!ctx) return { error: 'The document on this QR could not be found.' };
    return { ctx };
  }

  const classified = classifyDocumentNumber(scan);
  if (classified) {
    const ctx = await loadDocument(db, classified.docType, classified.docNumber, preferredDirection);
    if (!ctx) return { error: `No ${classified.docType.toUpperCase()} found for ${classified.docNumber}.` };
    return { ctx };
  }

  return { unitScan: scan };
}

async function resolveScan({ direction, scan, user }) {
  const raw = normalizeScan(scan);
  if (!raw) {
    return { ok: false, valid: false, message: 'Scan a QR, TTSPL, serial, or AWB number.' };
  }
  const requested = DIRECTIONS.has(String(direction || '').toLowerCase())
    ? String(direction).toLowerCase()
    : null;

  const db = pool;
  const actor = await getActor(db, user);
  const resolved = await resolveDocumentContext(db, raw, requested);

  let ctx = resolved.ctx || null;
  let serial = null;

  if (resolved.error) {
    return { ok: true, valid: false, message: resolved.error, kind: 'invalid' };
  }

  if (resolved.unitScan) {
    serial = await findSerial(db, resolved.unitScan);
    if (!serial) {
      if (looksLikeAwb(resolved.unitScan)) {
        const awbCtx = await findByAwb(db, resolved.unitScan, requested);
        if (awbCtx?.invalid) {
          return { ok: true, valid: false, kind: 'invalid', message: awbCtx.message };
        }
        if (awbCtx) {
          ctx = awbCtx;
        }
      }
      if (!ctx) {
        return {
          ok: true,
          valid: false,
          message: 'This laptop is not expected for this movement.',
          kind: 'invalid',
          detail: 'No inventory record matched this TTSPL / serial.',
        };
      }
    } else {
      ctx = await findBySerial(db, serial, requested);
      if (!ctx) {
        await recordMovement(db, {
          session: null,
          ctx: {
            direction: requested || 'inward',
            source_type: 'unknown',
            reference_type: 'none',
            reference_number: null,
          },
          serial,
          result: 'invalid',
          message: 'This laptop is not expected for this movement.',
          actor,
        });
        return {
          ok: true,
          valid: false,
          kind: 'invalid',
          message: 'This laptop is not expected for this movement.',
          laptop: laptopDto(serial),
        };
      }
    }
  }

  const mismatch = directionMismatch(ctx, requested);
  if (mismatch) {
    return { ok: true, valid: false, kind: 'invalid', message: mismatch, movement: publicMovement(ctx) };
  }
  if (ctx.active === false) {
    return {
      ok: true,
      valid: false,
      kind: 'invalid',
      message: ctx.inactive_reason || 'This movement is no longer active.',
      movement: publicMovement(ctx),
    };
  }

  const session = await openOrReuseSession(db, ctx, actor);
  let view = await sessionView(db, session, ctx);

  if (serial) {
    const scanned = await scanSerialIntoSession(db, {
      session, ctx, serial, actor, awb: ctx.awb_number,
    });
    view = scanned.view;
    return {
      ok: true,
      valid: scanned.valid,
      kind: 'unit',
      message: scanned.message,
      ...view,
    };
  }

  return {
    ok: true,
    valid: true,
    kind: 'document',
    message: `${ctx.source_label} · ${ctx.reference_number}`,
    ...view,
  };
}

async function scanSerialIntoSession(db, {
  session, ctx, serial, actor, awb,
}) {
  const match = (ctx.laptops || []).find((l) => laptopMatches(l, serial));
  if (!match) {
    await recordMovement(db, {
      session, ctx, serial, actor, awb,
      result: 'invalid',
      message: 'This laptop is not associated with the expected document.',
    });
    const view = await sessionView(db, session, ctx);
    return {
      valid: false,
      message: 'This laptop is not expected for this movement.',
      view,
    };
  }

  if (await confirmedAlready(db, {
    direction: ctx.direction,
    referenceType: ctx.reference_type,
    referenceNumber: ctx.reference_number,
    serialId: serial.serial_id,
  })) {
    await recordMovement(db, {
      session, ctx, serial, actor, awb,
      result: 'invalid',
      message: 'This laptop has already been confirmed at the gate for this movement.',
    });
    const view = await sessionView(db, session, ctx);
    return {
      valid: false,
      message: 'This laptop has already been scanned for this movement.',
      view,
    };
  }

  if (await scannedInSession(db, session.session_id, serial.serial_id)) {
    const view = await sessionView(db, session, ctx);
    return {
      valid: false,
      message: 'This laptop has already been scanned.',
      view,
    };
  }

  await recordMovement(db, {
    session, ctx, serial, actor, awb,
    result: 'valid',
    message: 'VALID',
  });
  const view = await sessionView(db, session, ctx);
  return {
    valid: true,
    message: 'VALID',
    view,
    laptop: laptopDto(serial, { scanned: true, scan_result: 'valid' }),
  };
}

async function reloadContextForSession(db, session) {
  return loadDocument(
    db,
    session.reference_type,
    session.reference_number,
    session.direction
  );
}

async function scanUnit({ sessionId, scan, user }) {
  const raw = normalizeScan(scan);
  if (!raw) {
    return { ok: false, valid: false, message: 'Scan a TTSPL or serial number.' };
  }
  const db = pool;
  const actor = await getActor(db, user);
  const sessRes = await db.query(`SELECT * FROM gate_scan_sessions WHERE session_id = $1`, [sessionId]);
  const session = sessRes.rows[0];
  if (!session) return { ok: false, valid: false, message: 'Scan session not found.' };
  if (session.status !== 'open') {
    return { ok: false, valid: false, message: 'This gate session is no longer open.' };
  }

  const ctx = await reloadContextForSession(db, session);
  if (!ctx) return { ok: false, valid: false, message: 'The expected movement could not be loaded.' };
  if (ctx.active === false) {
    return { ok: true, valid: false, message: ctx.inactive_reason || 'This movement is no longer active.' };
  }

  const serial = await findSerial(db, raw);
  if (!serial) {
    await recordMovement(db, {
      session, ctx, serial: { ttspl: normalizeTtspl(raw), serial_number: raw }, actor,
      result: 'invalid',
      message: 'No inventory record matched this TTSPL / serial.',
    });
    return {
      ok: true,
      valid: false,
      message: 'This laptop is not expected for this movement.',
      ...(await sessionView(db, session, ctx)),
    };
  }

  const scanned = await scanSerialIntoSession(db, {
    session, ctx, serial, actor, awb: session.awb_number,
  });
  return {
    ok: true,
    valid: scanned.valid,
    message: scanned.message,
    laptop: scanned.laptop || laptopDto(serial, {
      scanned: scanned.valid,
      scan_result: scanned.valid ? 'valid' : 'invalid',
    }),
    ...scanned.view,
  };
}

async function confirmSession({ sessionId, remarks, user }) {
  const db = pool;
  const actor = await getActor(db, user);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessRes = await client.query(
      `SELECT * FROM gate_scan_sessions WHERE session_id = $1 FOR UPDATE`,
      [sessionId]
    );
    const session = sessRes.rows[0];
    if (!session) {
      await client.query('ROLLBACK');
      return { ok: false, message: 'Scan session not found.' };
    }
    if (session.status === 'confirmed') {
      await client.query('COMMIT');
      return { ok: true, message: 'Gate movement already confirmed.', session_id: session.session_id };
    }
    if (session.status !== 'open') {
      await client.query('ROLLBACK');
      return { ok: false, message: 'This gate session is no longer open.' };
    }

    const ctx = await reloadContextForSession(client, session);
    if (!ctx) {
      await client.query('ROLLBACK');
      return { ok: false, message: 'The expected movement could not be loaded.' };
    }
    if (ctx.active === false) {
      await client.query('ROLLBACK');
      return { ok: false, message: ctx.inactive_reason || 'This movement is no longer active.' };
    }

    const view = await sessionView(client, session, ctx);
    if (!view.can_confirm) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        message: session.allow_partial
          ? 'Scan at least one valid laptop before confirming.'
          : `Scan all expected laptops before confirming (${view.scanned_count}/${view.expected_count}).`,
        ...view,
      };
    }

    await client.query(
      `UPDATE gate_movements
          SET confirmed_at = NOW(),
              remarks = COALESCE($2, remarks)
        WHERE session_id = $1
          AND validation_result = 'valid'
          AND confirmed_at IS NULL`,
      [session.session_id, remarks || null]
    );
    await client.query(
      `UPDATE gate_scan_sessions
          SET status = 'confirmed',
              confirmed_at = NOW(),
              remarks = COALESCE($2, remarks)
        WHERE session_id = $1`,
      [session.session_id, remarks || null]
    );

    const confirmed = await client.query(
      `SELECT serial_id, ttspl, serial_number FROM gate_movements
        WHERE session_id = $1 AND validation_result = 'valid' AND confirmed_at IS NOT NULL`,
      [session.session_id]
    );
    for (const row of confirmed.rows) {
      if (!row.ttspl) continue;
      await logTtsplEvent({
        ttsplId: row.ttspl,
        vendorSerialId: row.serial_id,
        eventType: session.direction === 'inward' ? 'gate_inward' : 'gate_outward',
        description: `Guard ${session.direction} confirmed on ${session.reference_number}`,
        metadata: {
          direction: session.direction,
          source_type: session.source_type,
          reference_type: session.reference_type,
          reference_number: session.reference_number,
          guard_name: actor.name,
        },
        actorUserId: actor.userId,
        actorName: actor.name,
        db: client,
      });
    }

    await client.query('COMMIT');
    return {
      ok: true,
      message: `Gate ${session.direction} confirmed.`,
      session_id: session.session_id,
      confirmed_count: confirmed.rows.length,
      direction: session.direction,
      reference_number: session.reference_number,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function getSession(sessionId) {
  const r = await pool.query(`SELECT * FROM gate_scan_sessions WHERE session_id = $1`, [sessionId]);
  if (!r.rows[0]) return null;
  const ctx = await reloadContextForSession(pool, r.rows[0]);
  if (!ctx) return { session_id: sessionId, status: r.rows[0].status, laptops: [] };
  return sessionView(pool, r.rows[0], ctx);
}

async function getDashboard({ userId, role } = {}) {
  const todayFilter = `scan_time >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
                       AT TIME ZONE 'Asia/Kolkata'`;
  const guardFilter = role === 'guard' && userId
    ? 'AND guard_user_id = $1'
    : '';
  const params = role === 'guard' && userId ? [userId] : [];

  const stats = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE validation_result = 'valid' AND direction = 'inward' AND ${todayFilter})::int AS inward_today,
        COUNT(*) FILTER (WHERE validation_result = 'valid' AND direction = 'outward' AND ${todayFilter})::int AS outward_today,
        COUNT(*) FILTER (WHERE validation_result = 'invalid' AND ${todayFilter})::int AS invalid_today
       FROM gate_movements
      WHERE 1=1 ${guardFilter}`,
    params
  );

  const pending = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM gate_scan_sessions
      WHERE status = 'open'
        ${role === 'guard' && userId ? 'AND guard_user_id = $1' : ''}`,
    params
  );

  const recent = await pool.query(
    `SELECT scan_time, ttspl, serial_number, direction, source_type,
            reference_number, validation_result, guard_name
       FROM gate_movements
      WHERE 1=1 ${guardFilter}
      ORDER BY scan_time DESC
      LIMIT 20`,
    params
  );

  return {
    inward_today: stats.rows[0]?.inward_today || 0,
    outward_today: stats.rows[0]?.outward_today || 0,
    pending_validation: pending.rows[0]?.n || 0,
    invalid_today: stats.rows[0]?.invalid_today || 0,
    recent: recent.rows,
  };
}

async function getHistory({ userId, role, limit = 50 } = {}) {
  const params = [];
  let where = '1=1';
  if (role === 'guard' && userId) {
    params.push(userId);
    where += ` AND guard_user_id = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 50, 200));
  const r = await pool.query(
    `SELECT id, scan_time, direction, source_type, reference_type, reference_number,
            ttspl, serial_number, awb_number, validation_result, validation_message,
            guard_name, confirmed_at
       FROM gate_movements
      WHERE ${where}
      ORDER BY scan_time DESC
      LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

module.exports = {
  resolveScan,
  scanUnit,
  confirmSession,
  getSession,
  getDashboard,
  getHistory,
};
