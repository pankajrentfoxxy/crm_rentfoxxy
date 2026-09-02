/**
 * Guard Gate Movement Validation.
 *
 * QR scan and laptop checks do not change inventory. Outward Submit is the
 * dispatch event: dispatch_ready → in_transit with dispatched_at = gate time.
 */
const pool = require('../config/db');
const { logTtsplEvent } = require('./ttsplAuditService');
const { formatTtspl, parseTtsplNum } = require('./vendorInventoryAssetCodeService');
const { parseGateQrPayload, lookupToken } = require('./gateQrService');
const inventorySM = require('./inventoryStateMachine');
const { compareConfig } = require('./grnConfigService');
const { resolveVrdcItemSpecs, enrichVrdcItemRow, buildVrdcConfigurationString } = require('./vendorRepairDcShared');

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
  const specs = resolveVrdcItemSpecs({ extra: extra && typeof extra === 'object' ? extra : {} });
  return formatConfigDisplay(specs);
}

function parseConfigLine(str) {
  const parts = String(str || '').split(/[·/|]/).map((s) => s.trim()).filter((p) => p && p !== '-');
  if (parts.length >= 6) {
    return {
      brand: parts[0] || '',
      model: parts[1] || '',
      processor: parts[2] || '',
      generation: parts[3] || '',
      ram: parts[4] || '',
      storage: parts[5] || '',
      ssd: parts[5] || '',
    };
  }
  if (parts.length === 5) {
    return {
      brand: parts[0] || '',
      model: parts[1] || '',
      processor: parts[2] || '',
      generation: '',
      ram: parts[3] || '',
      storage: parts[4] || '',
      ssd: parts[4] || '',
    };
  }
  return {
    brand: parts[0] || '',
    model: parts[1] || '',
    processor: parts[2] || '',
    generation: parts[3] || '',
    ram: parts[4] || '',
    storage: parts[5] || '',
    ssd: parts[5] || '',
  };
}

function formatConfigDisplay(specs = {}) {
  return [
    specs.brand,
    specs.model,
    specs.processor,
    specs.generation,
    specs.ram,
    specs.storage || specs.ssd,
  ].filter((v) => v != null && String(v).trim() !== '' && String(v).trim() !== '-').join(' · ') || null;
}

function toCompareShape(specs = {}) {
  return {
    brand: specs.brand,
    model: specs.model,
    processor: specs.processor,
    generation: specs.generation,
    ram: specs.ram,
    ssd: specs.storage || specs.ssd,
    gpu: specs.gpu,
  };
}

const CONFIG_FIELD_LABELS = {
  brand: 'Brand',
  model: 'Model',
  processor: 'Processor',
  generation: 'Generation',
  ram: 'RAM',
  ssd: 'Storage',
  gpu: 'GPU',
};

function formatConfigMismatchMessage(errors = []) {
  if (!errors.length) return 'Laptop configuration does not match this movement';
  return errors.map((e) => {
    const label = CONFIG_FIELD_LABELS[e.field] || e.field;
    return `${label}: expected "${e.expected ?? '—'}", scanned "${e.actual ?? '—'}"`;
  }).join(' · ');
}

function normalizeConfigKey(str) {
  return String(str || '')
    .split(/[·/|]/)
    .map((p) => p.trim())
    .filter((p) => p && p !== '-')
    .join('|')
    .toUpperCase();
}

function hasConfigFields(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Boolean(
    obj.brand || obj.model || obj.processor || obj.ram
    || obj.storage || obj.ssd || obj.generation
  );
}

/** Prefer serial.extra specs; fall back to parsing serial.configuration. */
function resolveSerialConfigSource(serial) {
  const extra = parseJson(serial?.extra, null);
  if (hasConfigFields(extra)) {
    return { ...extra, extra };
  }
  const cfg = serial?.configuration;
  if (cfg) {
    const parsed = parseConfigLine(cfg);
    return { ...parsed, extra: parsed };
  }
  return {};
}

function compareMovementConfigs(expectedLine, actualExtra) {
  const extra = actualExtra && typeof actualExtra === 'object' ? actualExtra : {};
  const expectedSpecs = resolveVrdcItemSpecs(parseConfigLine(expectedLine));
  const actualSpecs = resolveVrdcItemSpecs({ ...extra, extra });
  const expectedDisplay = formatConfigDisplay(expectedSpecs);
  const scannedDisplay = formatConfigDisplay(actualSpecs);

  if (
    expectedDisplay && scannedDisplay
    && normalizeConfigKey(expectedDisplay) === normalizeConfigKey(scannedDisplay)
  ) {
    return {
      matched: true,
      expected: expectedDisplay,
      scanned: scannedDisplay,
      errors: [],
      mismatch_message: '',
    };
  }

  const result = compareConfig(
    toCompareShape(expectedSpecs),
    { ...toCompareShape(actualSpecs), manufacturer: actualSpecs.brand }
  );
  return {
    matched: result.configurationMatched,
    expected: expectedDisplay,
    scanned: scannedDisplay,
    errors: result.errors || [],
    mismatch_message: formatConfigMismatchMessage(result.errors),
  };
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
  if (/^VRDC\/.+-(R|REP)\d+$/i.test(n)) {
    return { docType: 'vrdc_receive', docNumber: original };
  }
  if (/^VRDC/i.test(n)) return { docType: 'vrdc', docNumber: original };
  if (/^RDC/i.test(n)) return { docType: 'rdc', docNumber: original };
  if (/^SDC/i.test(n)) return { docType: 'sdc', docNumber: original };
  if (/^GRN/i.test(n)) return { docType: 'grn', docNumber: original };
  if (/^SO[\/-]/i.test(n) || /^SO-\d/i.test(n)) {
    return { docType: 'so', docNumber: original };
  }
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

function movementModeLabel(shipBy, dispatchMode) {
  const v = String(dispatchMode || shipBy || '').toLowerCase();
  if (!v) return null;
  if (v.includes('courier')) return 'Courier';
  if (v.includes('porter')) return 'Porter';
  if (v.includes('hand') || v.includes('inhouse') || v.includes('in-house')) return 'In-house';
  return dispatchMode || shipBy;
}

function checkRow(ok, expected, scanned, passMessage, failMessage) {
  return {
    ok: Boolean(ok),
    expected: expected || null,
    scanned: scanned || null,
    message: ok ? passMessage : failMessage,
  };
}

function firstFailedMessage(checks) {
  const failed = Object.values(checks || {}).find((c) => c && !c.ok);
  return failed?.message || 'Verification failed.';
}

function buildLaptopChecks({ expected, serial, ctx, scanRaw, sessionDirection }) {
  const scan = normalizeCode(scanRaw);
  const expTtspl = normalizeTtspl(expected?.ttspl || '');
  const gotTtspl = normalizeTtspl(serial?.ttspl || '');
  const ttsplOk = Boolean(
    (expTtspl && gotTtspl && expTtspl === gotTtspl)
    || (!expTtspl && !gotTtspl)
    || (scan && expTtspl && normalizeTtspl(scan) === expTtspl)
    || (scan && gotTtspl && normalizeTtspl(scan) === gotTtspl)
  );

  const expSn = normalizeCode(expected?.serial_number);
  const gotSn = normalizeCode(serial?.serial_number);
  const serialOk = Boolean(
    (expSn && gotSn && expSn === gotSn)
    || (!expSn && !gotSn)
    || (scan && expSn && scan === expSn)
    || (scan && gotSn && scan === gotSn)
  );

  const expCfg = expected?.configuration || '';
  const serialConfigSource = resolveSerialConfigSource(serial);
  const configCmp = compareMovementConfigs(expCfg, serialConfigSource);
  const configOk = configCmp.matched;

  const selected = sessionDirection || ctx?.session_direction || ctx?.direction;
  const modeLabel = `${String(ctx?.direction || '').toUpperCase()}${ctx?.movement_mode ? ` · ${ctx.movement_mode}` : ''}`;
  const modeOk = Boolean(ctx?.direction)
    && ctx.direction === selected
    && ctx.active !== false;

  const checks = {
    ttspl: checkRow(
      ttsplOk,
      expected?.ttspl,
      serial?.ttspl || scanRaw,
      'TTSPL matches this movement',
      'TTSPL does not match the expected laptop'
    ),
    serial_number: checkRow(
      serialOk,
      expected?.serial_number,
      serial?.serial_number || scanRaw,
      'Serial number matches this movement',
      'Serial number does not match the expected laptop'
    ),
    configuration: checkRow(
      configOk,
      configCmp.expected || expCfg || null,
      configCmp.scanned || formatConfigDisplay(resolveVrdcItemSpecs(serialConfigSource)) || serial?.configuration || null,
      'Laptop configuration matches',
      configCmp.mismatch_message || 'Laptop configuration does not match this movement'
    ),
    movement_mode: checkRow(
      modeOk,
      modeLabel || null,
      modeLabel || null,
      'Movement mode matches this document',
      'Movement mode does not match this document'
    ),
  };
  const all_passed = Object.values(checks).every((c) => c.ok);
  return { checks, all_passed };
}

function laptopDto(row, extra = {}) {
  const rowExtra = parseJson(row.extra, null);
  return {
    serial_id: row.serial_id || null,
    ttspl: row.ttspl || row.inventory_asset_code || row.ttspl_id || extra.ttspl || null,
    serial_number: row.serial_number || extra.serial_number || null,
    configuration: row.configuration || formatConfigDisplay(resolveVrdcItemSpecs(rowExtra || {})) || extra.configuration || null,
    extra: rowExtra,
    inventory_status: row.inventory_status || extra.inventory_status || null,
    awb_number: row.awb_number || extra.awb_number || null,
    scanned: Boolean(extra.scanned),
    verified: Boolean(extra.verified),
    scan_result: extra.scan_result || null,
    checks: extra.checks || row.checks || null,
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
    awb_numbers: ctx.awb_numbers || (ctx.awb_number ? String(ctx.awb_number).split(',').map((s) => s.trim()).filter(Boolean) : []),
    movement_mode: ctx.movement_mode || null,
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
    return laptopDto({
      ...u,
      ...hit,
      serial_id: hit.serial_id || u.serial_id || null,
      ttspl: hit.ttspl || u.ttspl || null,
      serial_number: hit.serial_number || u.serial_number || null,
      awb_number: u.awb_number || hit.awb_number || null,
      extra: hit.extra || u.extra,
    });
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
  let shipments = [];
  try {
    const ship = await db.query(
      `SELECT serial_id, ttspl_id, serial_number, awb_number
         FROM dc_shipment_units
        WHERE dc_number = $1`,
      [dcNumber]
    );
    shipments = ship.rows;
  } catch (_) { /* table may not exist on very old DBs */ }

  const awbById = new Map();
  const awbByCode = new Map();
  for (const s of shipments) {
    if (s.serial_id && s.awb_number) awbById.set(Number(s.serial_id), s.awb_number);
    if (s.ttspl_id && s.awb_number) awbByCode.set(normalizeCode(s.ttspl_id), s.awb_number);
    if (s.serial_number && s.awb_number) awbByCode.set(normalizeCode(s.serial_number), s.awb_number);
  }

  let units = sos.rows.map((row) => ({
    serial_id: row.serial_id,
    ttspl: row.ttspl,
    serial_number: row.serial_number,
    awb_number: (row.serial_id && awbById.get(Number(row.serial_id)))
      || awbByCode.get(normalizeCode(row.ttspl))
      || awbByCode.get(normalizeCode(row.serial_number))
      || null,
  }));
  if (!units.length) {
    units = r.rows.flatMap((row) => unitsFromSerialJson(row.serial_number)).map((u) => ({
      ...u,
      awb_number: (u.serial_id && awbById.get(Number(u.serial_id)))
        || awbByCode.get(normalizeCode(u.ttspl))
        || awbByCode.get(normalizeCode(u.serial_number))
        || null,
    }));
  }
  const laptops = uniqueLaptops(await enrichLaptops(db, units));
  const awbNumbers = [...new Set(laptops.map((l) => l.awb_number).filter(Boolean))];
  const awb = awbNumbers.join(', ')
    || r.rows.map((row) => row.awb_number).filter(Boolean)[0]
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
    awb_numbers: awbNumbers,
    movement_mode: movementModeLabel(head.ship_by, head.dispatch_mode),
    allow_partial: awbNumbers.length > 1 || laptops.length > 1,
    active,
    inactive_reason,
    laptops,
    statuses,
  };
}

let pickupGateColsReady = false;
async function ensurePickupGateInwardColumns(db) {
  if (pickupGateColsReady) return;
  await db.query(`
    ALTER TABLE support_ticket_items
      ADD COLUMN IF NOT EXISTS gate_inward_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS gate_inward_by INTEGER REFERENCES users (user_id),
      ADD COLUMN IF NOT EXISTS gate_inward_session_id UUID
  `);
  pickupGateColsReady = true;
}

function isCourierOrPorterPickup(item) {
  const method = String(item?.pickup_method || '').toLowerCase();
  return method === 'courier' || method === 'porter';
}

function pickupReadyForGateInward(item) {
  if (isCourierOrPorterPickup(item)) return true;
  return !!(item.customer_otp_verified_at || item.picked_up_at || item.technician_esign_at);
}

async function loadReturnDc(db, rdcNumber) {
  await ensurePickupGateInwardColumns(db);
  const r = await db.query(
    `SELECT dc_number, sales_order_number, customer_name, status, dc_purpose,
            movement_type, awb_number, porter_tracking_id, serial_number,
            warehouse_received_at, support_ticket_id, ship_by, dispatch_mode
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
            return_dc_number, pickup_method, customer_otp_verified_at,
            picked_up_at, technician_esign_at, gate_inward_at, status
       FROM support_ticket_items
      WHERE item_type = 'pickup'
        AND COALESCE(status, '') NOT IN ('cancelled')
        AND (
          return_dc_number = $1
          OR (
            return_dc_number IS NULL
            AND ticket_id = $2 AND $2 IS NOT NULL
          )
        )
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
  const gateInwardDone = items.rows.length > 0 && items.rows.every((i) => i.gate_inward_at);
  const pickupReady = items.rows.length === 0 || items.rows.every(pickupReadyForGateInward);

  let active = true;
  let inactive_reason = null;
  if (cancelled) {
    active = false;
    inactive_reason = 'This return DC is cancelled.';
  } else if (warehouseReceived) {
    active = false;
    inactive_reason = 'This return has already been received at the warehouse.';
  } else if (gateInwardDone) {
    active = false;
    inactive_reason = 'Guard inward already recorded. Warehouse can now e-sign.';
  } else if (!pickupReady) {
    active = false;
    inactive_reason = 'Technician has not completed customer pickup yet. Guard inward is after pickup.';
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
    movement_mode: movementModeLabel(head.ship_by, head.dispatch_mode),
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

function vrdcExpectedConfiguration(row) {
  const snap = parseJson(row.dispatch_config_snapshot, null);
  if (snap && typeof snap === 'object' && (snap.brand || snap.model || snap.ram || snap.ssd || snap.storage)) {
    return buildVrdcConfigurationString({ ...snap, storage: snap.ssd || snap.storage });
  }
  return enrichVrdcItemRow(row).configuration;
}

async function loadVendorRepairDc(db, dcNumber, preferredDirection) {
  try {
    await require('./vendorRepairDcService').ensureVendorRepairSchema();
  } catch (_) { /* schema ensure is best-effort */ }
  const headRes = await db.query(
    `SELECT dc_number, vendor_id, vendor_name, status, awb_number, porter_tracking_id,
            ship_by, dispatch_mode, gate_legacy, COALESCE(item_domain, 'laptop') AS item_domain
       FROM vendor_repair_delivery_challans
      WHERE dc_number = $1
      LIMIT 1`,
    [dcNumber]
  );
  if (!headRes.rows.length) return null;
  const head = headRes.rows[0];
  if (String(head.item_domain || 'laptop') !== 'laptop') return null;
  const items = await db.query(
    `SELECT i.id, i.serial_id, i.ttspl_id, i.serial_number, i.configuration, i.item_status,
            i.receive_dc_number, i.replacement_dc_number, i.dispatch_config_snapshot,
            vsn.extra AS serial_extra
       FROM vendor_repair_dc_items i
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = i.serial_id
      WHERE i.dc_number = $1
      ORDER BY i.id ASC`,
    [head.dc_number]
  );
  const dcStatus = String(head.status || '').toLowerCase();
  const direction = preferredDirection === 'inward' ? 'inward' : 'outward';

  const outwardItems = items.rows.filter((i) =>
    String(i.item_status || '').toLowerCase() === 'dispatch_ready'
  );
  const inwardItems = items.rows.filter((i) =>
    String(i.item_status || '').toLowerCase() === 'dispatched'
  );

  const pick = direction === 'inward' ? inwardItems : outwardItems;
  const units = pick.map((row) => ({
    serial_id: row.serial_id,
    ttspl: row.ttspl_id,
    serial_number: row.serial_number,
    configuration: vrdcExpectedConfiguration(row),
  }));
  const laptops = uniqueLaptops(await enrichLaptops(db, units));

  let active = true;
  let inactive_reason = null;
  if (direction === 'outward') {
    if (head.gate_legacy) {
      active = false;
      inactive_reason = 'This DC was dispatched before gate control was introduced.';
    } else if (dcStatus === 'draft') {
      active = false;
      inactive_reason = 'Warehouse has not e-signed this DC for dispatch yet.';
    } else if (dcStatus === 'dispatched') {
      active = false;
      inactive_reason = 'This DC has already gone out through the gate.';
    } else if (dcStatus === 'returned' || dcStatus === 'cancelled' || dcStatus === 'partially_returned') {
      active = false;
      inactive_reason = 'This vendor repair DC is no longer open for outward.';
    } else if (!outwardItems.length) {
      active = false;
      inactive_reason = 'No laptops on this DC are waiting for guard outward.';
    }
  } else if (dcStatus === 'cancelled') {
    active = false;
    inactive_reason = 'This vendor repair DC is cancelled.';
  } else if (inwardItems.length === 0) {
    active = false;
    inactive_reason = 'No units on this vendor repair DC are waiting for guard inward.';
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
    movement_mode: movementModeLabel(head.ship_by, head.dispatch_mode),
    allow_partial: direction === 'inward',
    active,
    inactive_reason,
    laptops,
    dc_number: head.dc_number,
  };
}

async function loadVendorRepairReceiveDc(db, receiveDcNumber) {
  let headRes;
  try {
    headRes = await db.query(
      `SELECT r.receive_dc_number, r.dc_number, r.gate_inward_at, r.closed_at,
              d.vendor_name, d.status, d.awb_number, d.porter_tracking_id,
              d.ship_by, d.dispatch_mode, d.gate_legacy,
              COALESCE(d.item_domain, 'laptop') AS item_domain
         FROM vendor_repair_receive_challans r
         JOIN vendor_repair_delivery_challans d ON d.dc_number = r.dc_number
        WHERE r.receive_dc_number = $1
        LIMIT 1`,
      [receiveDcNumber]
    );
  } catch (_) {
    return null;
  }
  if (!headRes.rows.length) return null;
  const head = headRes.rows[0];
  if (String(head.item_domain || 'laptop') !== 'laptop') return null;

  const items = await db.query(
    `SELECT i.id, i.serial_id, i.ttspl_id, i.serial_number, i.configuration, i.item_status,
            i.receive_dc_number, i.dispatch_config_snapshot,
            vsn.extra AS serial_extra
       FROM vendor_repair_dc_items i
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = i.serial_id
      WHERE i.receive_dc_number = $1
      ORDER BY i.id ASC`,
    [receiveDcNumber]
  );

  const pick = items.rows.filter((i) => String(i.item_status || '').toLowerCase() === 'dispatched');
  const units = items.rows.map((row) => ({
    serial_id: row.serial_id,
    ttspl: row.ttspl_id,
    serial_number: row.serial_number,
    configuration: vrdcExpectedConfiguration(row),
  }));
  const laptops = uniqueLaptops(await enrichLaptops(db, units));

  let active = true;
  let inactive_reason = null;
  if (head.closed_at) {
    active = false;
    inactive_reason = 'This receive challan has already been closed into stock.';
  } else if (head.gate_inward_at || !pick.length) {
    active = false;
    inactive_reason = 'This receive challan has already been passed inward.';
  } else if (!laptops.length) {
    active = false;
    inactive_reason = 'No laptops are waiting on this receive challan.';
  }

  return {
    direction: 'inward',
    source_type: 'vendor_repair_return',
    source_label: 'Vendor Repair Return',
    reference_type: 'vrdc_receive',
    reference_number: head.receive_dc_number,
    party_name: head.vendor_name || null,
    so_number: null,
    awb_number: head.awb_number || head.porter_tracking_id || null,
    movement_mode: movementModeLabel(head.ship_by, head.dispatch_mode),
    allow_partial: false,
    active,
    inactive_reason,
    laptops,
    dc_number: head.dc_number,
    receive_dc_number: head.receive_dc_number,
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
    movement_mode: 'Vendor inward',
    allow_partial: true,
    active: laptops.length > 0,
    inactive_reason: laptops.length ? null : 'No laptops are recorded on this GRN.',
    laptops,
    grn_id: row.grn_id,
  };
}

async function loadSalesOrder(db, soNumber) {
  const wanted = String(soNumber || '').trim();
  if (!wanted) return null;
  const r = await db.query(
    `SELECT dc_number, status
       FROM delivery_challan_lines
      WHERE sales_order_number = $1
        AND COALESCE(movement_type, 'outbound') <> 'return'
      ORDER BY
        CASE LOWER(COALESCE(status, ''))
          WHEN 'dispatch_ready' THEN 0
          WHEN 'pending' THEN 1
          WHEN 'processing' THEN 2
          ELSE 3
        END,
        id DESC
      LIMIT 1`,
    [wanted]
  );
  if (!r.rows[0]) return null;
  return loadOutboundDc(db, r.rows[0].dc_number);
}

async function loadDocument(db, docType, docNumber, preferredDirection) {
  if (docType === 'dc') return loadOutboundDc(db, docNumber);
  if (docType === 'so') return loadSalesOrder(db, docNumber);
  if (docType === 'rdc') return loadReturnDc(db, docNumber);
  if (docType === 'sdc') return loadServiceDc(db, docNumber);
  if (docType === 'vrdc') return loadVendorRepairDc(db, docNumber, preferredDirection);
  if (docType === 'vrdc_receive') return loadVendorRepairReceiveDc(db, docNumber);
  if (docType === 'grn') return loadGrn(db, docNumber);
  return null;
}

function filterContextByAwb(ctx, awb) {
  if (!ctx || !awb) return ctx;
  const token = normalizeCode(awb);
  const matched = (ctx.laptops || []).filter((l) => normalizeCode(l.awb_number) === token);
  if (!matched.length) return ctx;
  return {
    ...ctx,
    laptops: matched,
    awb_number: matched[0].awb_number || awb,
    awb_numbers: [...new Set(matched.map((l) => l.awb_number).filter(Boolean))],
    allow_partial: false,
  };
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
      const scoped = filterContextByAwb(ctx, token);
      scoped.awb_number = scoped.awb_number || token;
      if (preferredDirection && scoped.direction !== preferredDirection) {
        return invalidCtx(`This AWB is expected as ${scoped.direction.toUpperCase()}, not ${preferredDirection.toUpperCase()}.`);
      }
      return scoped;
    }
  }

  const vrdc = await db.query(
    `SELECT dc_number, awb_number, porter_tracking_id, status
       FROM vendor_repair_delivery_challans
      WHERE COALESCE(item_domain, 'laptop') = 'laptop'
        AND (awb_number ILIKE '%' || $1 || '%'
         OR porter_tracking_id ILIKE '%' || $1 || '%')
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
        AND COALESCE(d.item_domain, 'laptop') = 'laptop'
      ORDER BY i.id DESC
      LIMIT 3`,
    [serial.serial_id, serial.ttspl, serial.serial_number]
  );
  for (const row of vrdc.rows) {
    const itemStatus = String(row.item_status || '').toLowerCase();
    const pref = ['received', 'replacement_received', 'gate_received'].includes(itemStatus)
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
    const leftWarehouse = ['reserved', 'dispatch_ready', 'in_transit', 'rented', 'on_demo', 'sold', 'scrapped']
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
  const a = normalizeTtspl(laptop.ttspl || '') || normalizeCode(laptop.ttspl);
  const b = normalizeTtspl(serial.ttspl || '') || normalizeCode(serial.ttspl);
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

async function attachScanState(db, session, laptops, ctx) {
  const scans = await db.query(
    `SELECT serial_id, ttspl, serial_number, validation_result, scan_time, confirmed_at, metadata
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
  const latestById = new Map();
  const latestByCode = new Map();
  for (const s of scans.rows) {
    if (s.serial_id) latestById.set(Number(s.serial_id), s);
    if (s.ttspl) latestByCode.set(normalizeCode(s.ttspl), s);
    if (s.serial_number) latestByCode.set(normalizeCode(s.serial_number), s);
  }
  const enriched = await enrichLaptops(db, laptops);
  return enriched.map((l) => {
    const hit = (l.serial_id && latestById.get(Number(l.serial_id)))
      || latestByCode.get(normalizeCode(l.ttspl))
      || latestByCode.get(normalizeCode(l.serial_number))
      || null;

    let checks = null;
    let verified = hit?.validation_result === 'valid';
    if (hit && ctx) {
      const { checks: freshChecks, all_passed } = buildLaptopChecks({
        expected: l,
        serial: l,
        ctx,
        scanRaw: l.ttspl || l.serial_number,
        sessionDirection: session.direction,
      });
      checks = freshChecks;
      verified = hit.validation_result === 'valid' && all_passed;
    } else if (verified) {
      checks = {
        ttspl: { ok: true, expected: l.ttspl, scanned: l.ttspl, message: 'TTSPL matches this movement' },
        serial_number: { ok: true, expected: l.serial_number, scanned: l.serial_number, message: 'Serial number matches this movement' },
        configuration: { ok: true, expected: l.configuration, scanned: l.configuration, message: 'Laptop configuration matches' },
        movement_mode: { ok: true, expected: session.direction, scanned: session.direction, message: 'Movement mode matches this document' },
      };
    }

    return {
      ...laptopDto(l, {
        scanned: Boolean(hit),
        verified,
        scan_result: hit?.validation_result || null,
        checks,
      }),
      scanned_at: hit?.scan_time || null,
      already_confirmed: Boolean(hit?.confirmed_at),
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
  if (existing.rows[0]) {
    const session = existing.rows[0];
    if (Boolean(session.allow_partial) !== Boolean(ctx.allow_partial)) {
      const upd = await db.query(
        `UPDATE gate_scan_sessions
            SET allow_partial = $2, expected_count = $3
          WHERE session_id = $1
        RETURNING *`,
        [session.session_id, Boolean(ctx.allow_partial), ctx.laptops.length]
      );
      return upd.rows[0] || session;
    }
    return session;
  }

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
        movement_mode: ctx.movement_mode || null,
      }),
    ]
  );
  return ins.rows[0];
}

async function sessionView(db, session, ctx) {
  const laptops = await attachScanState(db, session, ctx.laptops || [], ctx);
  const verifiedCount = laptops.filter((l) => l.verified).length;
  const allGreen = laptops.length > 0 && laptops.every((l) => l.verified);
  const pending = await db.query(
    `SELECT COUNT(*)::int AS n FROM gate_movements
      WHERE session_id = $1 AND validation_result = 'valid' AND confirmed_at IS NULL`,
    [session.session_id]
  );
  const pendingCount = pending.rows[0]?.n || 0;
  const allowPartial = Boolean(ctx.allow_partial);
  const complete = allGreen || (allowPartial && pendingCount > 0);
  let block_submit_reason = null;
  if (session.status !== 'open') {
    block_submit_reason = 'This movement has already been submitted.';
  } else if (ctx.active === false) {
    block_submit_reason = ctx.inactive_reason || 'This movement is no longer active.';
  } else if (!complete) {
    const next = laptops.find((l) => !l.verified);
    if (next) {
      block_submit_reason = `Scan ${next.ttspl || next.serial_number} to verify the next laptop.`;
    } else if (allowPartial) {
      block_submit_reason = 'Verify at least one laptop (all four checks green) before submit.';
    } else {
      block_submit_reason = 'Complete TTSPL, serial, configuration, and movement mode checks on every laptop.';
    }
  }
  return {
    session_id: session.session_id,
    status: session.status,
    allow_partial: allowPartial,
    expected_count: laptops.length,
    scanned_count: verifiedCount,
    remaining_count: Math.max(0, laptops.length - verifiedCount),
    all_checks_passed: allGreen,
    block_submit_reason,
    movement: publicMovement({ ...ctx, laptops, allow_partial: allowPartial }),
    laptops,
    can_confirm: session.status === 'open'
      && ctx.active !== false
      && pendingCount > 0
      && complete,
  };
}

async function recordMovement(db, {
  session, ctx, serial, result, message, actor, awb, extraMeta,
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
        ...(extraMeta || {}),
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

  if (!ctx) {
    return {
      ok: true,
      valid: false,
      kind: 'invalid',
      message: 'This laptop is not expected for this movement.',
    };
  }

  const mismatch = directionMismatch(ctx, requested);
  const autoSwitch = Boolean(
    mismatch && ['dc', 'rdc', 'sdc', 'grn'].includes(String(ctx.reference_type || ''))
  );
  if (mismatch && !autoSwitch) {
    return {
      ok: true,
      valid: false,
      kind: 'direction_mismatch',
      message: mismatch,
      direction: ctx.direction,
      movement: publicMovement(ctx),
    };
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

  // Scanning a TTSPL / serial must also run laptop checks. Opening the DC/SO
  // alone used to leave Submit locked at 0/1 verified.
  if (serial) {
    const scanned = await scanSerialIntoSession(db, {
      session,
      ctx,
      serial,
      actor,
      awb: session.awb_number,
      scanRaw: raw,
    });
    return {
      ok: true,
      valid: scanned.valid,
      all_passed: Boolean(scanned.all_passed),
      processed: false,
      kind: 'unit',
      message: scanned.message
        || (scanned.valid
          ? 'Laptop verified. Submit when every laptop is green.'
          : 'Laptop opened this movement but checks did not pass.'),
      checks: scanned.checks || null,
      laptop: scanned.laptop || laptopDto(serial, {
        scanned: true,
        verified: scanned.valid,
        scan_result: scanned.valid ? 'valid' : 'invalid',
        checks: scanned.checks || null,
      }),
      ...scanned.view,
      direction: ctx.direction,
    };
  }

  const fromDocument = Boolean(resolved.ctx) && !resolved.unitScan;
  let autoVerified = 0;
  if (fromDocument) {
    autoVerified = await autoVerifyDocumentLaptops(db, { session, ctx, actor });
  }
  const view = await sessionView(db, session, ctx);

  let message = 'Now scan the laptop TTSPL or serial to verify, then submit.';
  if (autoSwitch) {
    message = `Opened as ${ctx.direction.toUpperCase()} for this document.`;
  }
  if (autoVerified > 0) {
    message = autoVerified === (ctx.laptops || []).length
      ? `${autoVerified} laptop(s) verified from this document. Submit ${ctx.direction.toUpperCase()} to process.`
      : `${autoVerified} of ${(ctx.laptops || []).length} laptop(s) verified from this document.`;
  }

  return {
    ok: true,
    valid: true,
    processed: false,
    kind: 'verification',
    ...view,
    direction: ctx.direction,
    auto_verified: autoVerified,
    message,
  };
}

async function autoVerifyDocumentLaptops(db, { session, ctx, actor }) {
  const laptops = ctx.laptops || [];
  let verified = 0;
  for (const laptop of laptops) {
    const serial = laptop.serial_id
      ? await findSerialById(db, laptop.serial_id)
      : await findSerial(db, laptop.ttspl || laptop.serial_number);
    if (!serial) continue;
    const scanned = await scanSerialIntoSession(db, {
      session,
      ctx,
      serial,
      actor,
      awb: laptop.awb_number || session.awb_number,
      scanRaw: laptop.ttspl || laptop.serial_number || serial.ttspl,
    });
    if (scanned.valid) verified += 1;
  }
  return verified;
}

async function findSerialById(db, serialId) {
  const id = Number(serialId);
  if (!id) return null;
  const r = await db.query(
    `SELECT serial_id, serial_number, inventory_status, qc_status, grn_id,
            current_dc_number, current_customer_id,
            COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl,
            extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND serial_id = $1
      LIMIT 1`,
    [id]
  );
  return r.rows[0] || null;
}

async function scanSerialIntoSession(db, {
  session, ctx, serial, actor, awb, scanRaw,
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
      all_passed: false,
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
      all_passed: false,
      message: 'This laptop has already been scanned for this movement.',
      view,
    };
  }

  if (await scannedInSession(db, session.session_id, serial.serial_id)) {
    const view = await sessionView(db, session, ctx);
    const existing = (view.laptops || []).find((l) => laptopMatches(l, serial));
    return {
      valid: true,
      all_passed: true,
      message: 'This laptop has already been verified.',
      checks: existing?.checks || null,
      view,
      laptop: existing || laptopDto(serial, { scanned: true, verified: true, scan_result: 'valid' }),
    };
  }

  const { checks, all_passed } = buildLaptopChecks({
    expected: match,
    serial,
    ctx,
    scanRaw: scanRaw || serial.ttspl || serial.serial_number,
    sessionDirection: session.direction,
  });

  if (!all_passed) {
    const message = firstFailedMessage(checks);
    await recordMovement(db, {
      session, ctx, serial, actor, awb,
      result: 'invalid',
      message,
      extraMeta: { checks, all_passed: false },
    });
    const view = await sessionView(db, session, ctx);
    return {
      valid: false,
      all_passed: false,
      message,
      checks,
      view,
      laptop: laptopDto(serial, {
        scanned: true,
        verified: false,
        scan_result: 'invalid',
        checks,
      }),
    };
  }

  await recordMovement(db, {
    session, ctx, serial, actor, awb,
    result: 'valid',
    message: 'All checks passed',
    extraMeta: { checks, all_passed: true },
  });
  const view = await sessionView(db, session, ctx);
  return {
    valid: true,
    all_passed: true,
    message: 'All checks passed',
    checks,
    view,
    laptop: laptopDto(serial, {
      scanned: true,
      verified: true,
      scan_result: 'valid',
      checks,
    }),
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
  const mismatch = directionMismatch(ctx, session.direction);
  if (mismatch) {
    return { ok: true, valid: false, message: mismatch, ...(await sessionView(db, session, ctx)) };
  }

  if (parseGateQrPayload(raw) || classifyDocumentNumber(raw)) {
    return resolveScan({ direction: session.direction, scan: raw, user });
  }

  let serial = await findSerial(db, raw);
  if (!serial) {
    const byAwb = (ctx.laptops || []).find((l) => l.awb_number && normalizeCode(l.awb_number) === normalizeCode(raw));
    if (byAwb) {
      serial = await findSerial(db, byAwb.ttspl || byAwb.serial_number);
    }
  }
  if (!serial) {
    await recordMovement(db, {
      session, ctx, serial: { ttspl: normalizeTtspl(raw), serial_number: raw }, actor,
      result: 'invalid',
      message: 'No inventory record matched this TTSPL / serial.',
    });
    return {
      ok: true,
      valid: false,
      all_passed: false,
      message: 'This laptop is not expected for this movement.',
      ...(await sessionView(db, session, ctx)),
    };
  }

  const scanned = await scanSerialIntoSession(db, {
    session, ctx, serial, actor, awb: session.awb_number, scanRaw: raw,
  });
  return {
    ok: true,
    valid: scanned.valid,
    all_passed: Boolean(scanned.all_passed),
    processed: false,
    kind: 'unit',
    message: scanned.message,
    checks: scanned.checks || null,
    laptop: scanned.laptop || laptopDto(serial, {
      scanned: true,
      verified: scanned.valid,
      scan_result: scanned.valid ? 'valid' : 'invalid',
      checks: scanned.checks || null,
    }),
    ...scanned.view,
  };
}

async function applyOutwardGateInventory(db, { session, serialRows, actor }) {
  if (session.direction !== 'outward') return null;
  if (!['dc', 'sdc'].includes(session.reference_type)) return null;
  const dcNumber = session.reference_number;
  if (!dcNumber) return null;

  const head = await db.query(
    `SELECT dcl.customer_id, dcl.entity_code, dcl.dispatch_mode, dcl.sales_order_number,
            COALESCE(sol.quotation_type, sq.quotation_type, 'rental') AS quotation_type
       FROM delivery_challan_lines dcl
       LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
       LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
      WHERE dcl.dc_number = $1
      LIMIT 1`,
    [dcNumber]
  );
  const ctx = head.rows[0] || {};
  let rows = Array.isArray(serialRows) ? serialRows.filter((r) => r.serial_id) : [];
  if (!rows.length) {
    const sos = await db.query(
      `SELECT serial_id FROM sales_order_serials
        WHERE dc_number = $1 AND status <> 'removed' AND serial_id IS NOT NULL`,
      [dcNumber]
    );
    rows = sos.rows;
  }
  const serialIds = rows.map((r) => r.serial_id).filter(Boolean);

  for (const row of rows) {
    if (!row.serial_id) continue;
    try {
      await inventorySM.markDispatched(db, row.serial_id, {
        dcNumber,
        customerId: ctx.customer_id || null,
        entityCode: ctx.entity_code || null,
        dispatchMode: ctx.dispatch_mode || null,
        actorUserId: actor.userId,
        actorName: actor.name,
      });
    } catch (dispErr) {
      console.error('guardGate.markDispatched', dispErr.message);
      await db.query(
        `UPDATE vendor_serial_numbers
            SET inventory_status = 'in_transit',
                current_dc_number = $2,
                dispatch_mode = COALESCE($3, dispatch_mode),
                dispatched_at = NOW(),
                status_changed_at = NOW(),
                updated_at = NOW()
          WHERE serial_id = $1`,
        [row.serial_id, dcNumber, ctx.dispatch_mode || null]
      );
    }
  }

  await db.query(
    `UPDATE delivery_challan_lines
        SET status = 'in_transit',
            dispatched_at = COALESCE(dispatched_at, NOW()),
            updated_at = NOW()
      WHERE dc_number = $1
        AND COALESCE(movement_type, 'outbound') <> 'return'
        AND status IN ('dispatch_ready', 'pending')`,
    [dcNumber]
  );

  if (serialIds.length) {
    try {
      await db.query(
        `UPDATE dc_shipment_units
            SET status = 'in_transit', updated_at = NOW()
          WHERE dc_number = $1 AND serial_id = ANY($2::int[])`,
        [dcNumber, serialIds]
      );
    } catch (_) { /* table may not exist */ }
  }

  return {
    dcNumber,
    salesOrderNumber: ctx.sales_order_number || null,
    customerId: ctx.customer_id || null,
    quotationType: ctx.quotation_type || null,
  };
}

async function applyInwardReturnDcGate(client, { session, actor }) {
  if (session.direction !== 'inward' || session.reference_type !== 'rdc') return;
  const rdc = session.reference_number;
  if (!rdc) return;

  await ensurePickupGateInwardColumns(client);
  const updated = await client.query(
    `UPDATE support_ticket_items
        SET gate_inward_at = COALESCE(gate_inward_at, NOW()),
            gate_inward_by = COALESCE(gate_inward_by, $2),
            gate_inward_session_id = COALESCE(gate_inward_session_id, $3),
            updated_at = NOW()
      WHERE return_dc_number = $1
        AND item_type = 'pickup'
        AND COALESCE(status, '') NOT IN ('cancelled')
      RETURNING id, ticket_id, gate_inward_at`,
    [rdc, actor.userId, session.session_id]
  );
  if (!updated.rows.length) return;

  const ticketIds = [...new Set(updated.rows.map((row) => row.ticket_id).filter(Boolean))];
  if (ticketIds.length) {
    await client.query(
      `UPDATE support_tickets SET updated_at = NOW() WHERE id = ANY($1::int[])`,
      [ticketIds]
    );
  }

  for (const row of updated.rows) {
    try {
      await client.query(
        `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
         VALUES ($1, $2, $3, 'gate_inward', $4::jsonb)`,
        [
          row.id,
          row.ticket_id,
          actor.userId,
          JSON.stringify({
            return_dc_number: rdc,
            session_id: session.session_id,
            guard_name: actor.name || null,
          }),
        ]
      );
    } catch (_) { /* audit table may differ */ }
  }
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
        message: view.block_submit_reason
          || (session.allow_partial
            ? 'Verify at least one laptop before submitting.'
            : `Complete all checks before submitting (${view.scanned_count}/${view.expected_count}).`),
        ...view,
      };
    }

    const remaining = (view.laptops || []).filter((l) => !l.verified).length;
    const stamped = await client.query(
      `UPDATE gate_movements
          SET confirmed_at = NOW(),
              remarks = COALESCE($2, remarks)
        WHERE session_id = $1
          AND validation_result = 'valid'
          AND confirmed_at IS NULL
        RETURNING serial_id, ttspl, serial_number`,
      [session.session_id, remarks || null]
    );
    if (remaining === 0) {
      await client.query(
        `UPDATE gate_scan_sessions
            SET status = 'confirmed',
                confirmed_at = NOW(),
                remarks = COALESCE($2, remarks)
          WHERE session_id = $1`,
        [session.session_id, remarks || null]
      );
    } else {
      await client.query(
        `UPDATE gate_scan_sessions
            SET remarks = COALESCE($2, remarks)
          WHERE session_id = $1`,
        [session.session_id, remarks || null]
      );
    }

    for (const row of stamped.rows) {
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

    const outward = await applyOutwardGateInventory(client, {
      session,
      serialRows: stamped.rows,
      actor,
    });

    if (remaining === 0) {
      await applyInwardReturnDcGate(client, { session, actor });
    }

    const vrGate = require('./vendorRepairGateService');
    const serialIds = stamped.rows.map((r) => r.serial_id).filter(Boolean);
    if (session.reference_type === 'vrdc' && session.direction === 'outward') {
      await vrGate.applyOutwardGateVrdc(client, {
        dcNumber: session.reference_number,
        serialIds,
        sessionId: session.session_id,
        actorUserId: actor.userId,
        actorName: actor.name,
      });
    }
    let inwardVrdc = null;
    if (
      (session.reference_type === 'vrdc' || session.reference_type === 'vrdc_receive')
      && session.direction === 'inward'
    ) {
      const ctxRecv = ctx.receive_dc_number || (session.reference_type === 'vrdc_receive' ? session.reference_number : null);
      inwardVrdc = await vrGate.applyInwardGateVrdc(client, {
        receiveDcNumber: ctxRecv,
        dcNumber: ctx.dc_number || session.reference_number,
        serialIds,
        sessionId: session.session_id,
        actorUserId: actor.userId,
      });
    }

    await client.query('COMMIT');

    if (inwardVrdc?.receive_dc_number && inwardVrdc?.dc_number) {
      try {
        const { generateVendorRepairReceivePdf } = require('./vendorRepairPdfService');
        const pdfPath = await generateVendorRepairReceivePdf(
          inwardVrdc.dc_number,
          inwardVrdc.receive_dc_number,
          inwardVrdc.item_ids || []
        );
        if (pdfPath) {
          await pool.query(
            `UPDATE vendor_repair_receive_challans SET pdf_path = $2 WHERE receive_dc_number = $1`,
            [inwardVrdc.receive_dc_number, pdfPath]
          );
        }
      } catch (pdfErr) {
        console.warn('[guardGate] receive PDF skipped:', pdfErr.message);
      }
    }

    if (outward?.salesOrderNumber) {
      try {
        const dispatchWf = require('./dispatchWorkflowService');
        await dispatchWf.onDispatched(pool, {
          salesOrderNumber: outward.salesOrderNumber,
          dcNumber: outward.dcNumber,
          user: { user_id: actor.userId, name: actor.name },
        });
      } catch (wfErr) {
        console.error('guardGate.onDispatched', wfErr.message);
      }
    }
    if (outward?.customerId && outward?.dcNumber
      && String(outward.quotationType || 'rental').toLowerCase() === 'rental') {
      try {
        const { maybeInvoiceOnRentalDcCreate } = require('./billingSchedulerService');
        await maybeInvoiceOnRentalDcCreate({
          customerId: outward.customerId,
          dcNumber: outward.dcNumber,
          quotationType: outward.quotationType,
        });
      } catch (billingErr) {
        console.error('guardGate.invoice', billingErr.message);
      }
    }
    try {
      const { invalidateInventoryListCachesFireAndForget } = require('./inventoryListCache');
      invalidateInventoryListCachesFireAndForget();
    } catch (_) { /* ignore */ }

    return {
      ok: true,
      message: remaining === 0
        ? `Gate ${session.direction} confirmed.`
        : `Gate ${session.direction} recorded for ${stamped.rows.length} laptop(s). Scan remaining units to continue.`,
      session_id: session.session_id,
      confirmed_count: stamped.rows.length,
      remaining_count: remaining,
      direction: session.direction,
      reference_number: session.reference_number,
      status: remaining === 0 ? 'confirmed' : 'open',
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
