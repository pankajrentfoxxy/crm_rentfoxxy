/**
 * Shared pure helpers for Vendor Repair Delivery Challans (laptop + part domains).
 * Extracted from vendorRepairDcService so part flows can reuse without coupling.
 * Behavioral contract must stay identical to the laptop service originals.
 */
const fs = require('fs');
const path = require('path');
const { stripBrandFromModel } = require('../utils/assetConfigNormalize');

const EWAY_VALUE_THRESHOLD = 50000;

function isBlankSpecValue(value) {
  const s = String(value ?? '').trim();
  return !s || s === '-';
}

/** Infer Apple when model text clearly indicates a Mac (common bad brand=Dell data). */
function inferBrandFromModel(brand, model) {
  const combined = `${brand || ''} ${model || ''}`.toLowerCase();
  if (/macbook|mac book|\bimac\b|mac mini|mac studio|\bmac pro\b/.test(combined)) {
    return 'Apple';
  }
  const b = String(brand || '').trim();
  if (/^apple$/i.test(b)) return 'Apple';
  return b;
}

/** Resolve laptop specs for VRDC display/creation — prefers inventory extra over stale ticket fields. */
function resolveVrdcItemSpecs(source = {}) {
  const extra = source.extra && typeof source.extra === 'object' ? source.extra : {};
  let brand = extra.brand || source.brand || '';
  let model = extra.model || extra.model_name || source.model || '';
  const processor = extra.processor || source.processor || '';
  const generation = extra.generation || source.generation || '';
  const ram = extra.ram || source.ram || '';
  const storage = extra.storage || source.storage || '';

  brand = inferBrandFromModel(brand, model);
  model = stripBrandFromModel(brand, model);
  if (/^dell\s+/i.test(model) && /apple|macbook/i.test(model)) {
    model = model.replace(/^dell\s+/i, '');
    brand = 'Apple';
    model = stripBrandFromModel(brand, model);
  }

  return { brand, model, processor, generation, ram, storage };
}

function buildVrdcConfigurationString(specs = {}) {
  const resolved = resolveVrdcItemSpecs(specs);
  return [
    resolved.brand,
    resolved.model,
    resolved.processor,
    resolved.generation,
    resolved.ram,
    resolved.storage,
  ].filter((v) => !isBlankSpecValue(v)).join(' · ');
}

function enrichVrdcItemRow(row = {}) {
  const extra = typeof row.serial_extra === 'string'
    ? (() => { try { return JSON.parse(row.serial_extra); } catch { return {}; } })()
    : (row.serial_extra || {});
  const configuration = buildVrdcConfigurationString({ ...row, extra });
  return { ...row, configuration };
}

function currentFinancialYearLabel(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  const a = String(startYear % 100).padStart(2, '0');
  const b = String((startYear + 1) % 100).padStart(2, '0');
  return `${a}-${b}`;
}

function parseItemPrice(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error('Price must be a non-negative number');
  return Math.round(n * 100) / 100;
}

function normalizeEwayBillNumber(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z0-9\/-]{8,30}$/.test(s)) {
    throw new Error('E-way Bill number format is invalid');
  }
  return s;
}

function requiresVrdcEway(totalValue) {
  return Number(totalValue || 0) > EWAY_VALUE_THRESHOLD;
}

function validateEwayForConsignment({ totalValue, ewayBillNumber, ewayBillDate, requireEway = true }) {
  const needsEway = requiresVrdcEway(totalValue);
  const num = normalizeEwayBillNumber(ewayBillNumber);
  const date = ewayBillDate ? String(ewayBillDate).trim() || null : null;
  if (requireEway && needsEway && !num) {
    throw new Error(`E-way Bill number is required when consignment value is above ₹${EWAY_VALUE_THRESHOLD.toLocaleString('en-IN')}`);
  }
  if (num && date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('E-way Bill date must be YYYY-MM-DD');
  }
  return { eway_bill_number: num, eway_bill_date: date || null, eway_required: needsEway };
}

function saveEsign(prefix, dcNumber, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const dir = path.join(__dirname, '../uploads/vendor-repair');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
  const filename = `${prefix}_${safe}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(m[2], 'base64'));
  return `vendor-repair/${filename}`;
}

function saveDispatchPod(dcNumber, dataUrl) {
  return saveEsign('dispatch_pod', dcNumber, dataUrl);
}

function normalizeShipBy(shipBy, dispatchMode) {
  if (shipBy === 'by_hand' || shipBy === 'by_courier' || shipBy === 'by_porter') return shipBy;
  if (dispatchMode === 'inhouse') return 'by_hand';
  if (dispatchMode === 'porter') return 'by_porter';
  if (dispatchMode === 'courier') return 'by_courier';
  return null;
}

function shipByToDispatchMode(shipBy) {
  if (shipBy === 'by_hand') return 'inhouse';
  if (shipBy === 'by_porter') return 'porter';
  if (shipBy === 'courier') return 'courier';
  return null;
}

function validateDispatchDetails({ shipBy, courierName, porterTrackingId, deliveryPersonId }) {
  if (!shipBy) throw new Error('Send mode is required (By Hand, Courier, or Porter)');
  if (shipBy === 'by_courier' && !courierName?.trim()) {
    throw new Error('Courier name is required for By Courier dispatch');
  }
  if (shipBy === 'by_porter' && !porterTrackingId?.trim()) {
    throw new Error('Porter tracking / booking ID is required');
  }
  if (shipBy === 'by_hand' && !deliveryPersonId) {
    throw new Error('Delivery person is required for By Hand dispatch');
  }
}

function dispatchPayloadFromBody(body) {
  const shipBy = normalizeShipBy(body.ship_by || body.shipBy, body.dispatch_mode || body.dispatchMode);
  const dispatchMode = shipByToDispatchMode(shipBy) || body.dispatch_mode || body.dispatchMode;
  const rawDeliveryPersonId = body.delivery_person_id ?? body.deliveryPersonId;
  const deliveryPersonId = rawDeliveryPersonId != null && String(rawDeliveryPersonId).trim() !== ''
    ? Number(rawDeliveryPersonId)
    : null;
  validateDispatchDetails({
    shipBy,
    courierName: body.courier_name || body.courierName,
    porterTrackingId: body.porter_tracking_id || body.porterTrackingId,
    deliveryPersonId,
  });
  return {
    ship_by: shipBy,
    dispatch_mode: dispatchMode,
    courier_name: shipBy === 'by_courier' ? (body.courier_name || body.courierName || '').trim() || null : null,
    awb_number: shipBy === 'by_courier' ? (body.awb_number || body.awbNumber || '').trim() || null : null,
    courier_tracking_url: shipBy === 'by_courier' ? (body.courier_tracking_url || body.courierTrackingUrl || '').trim() || null : null,
    porter_tracking_id: shipBy === 'by_porter' ? (body.porter_tracking_id || body.porterTrackingId || '').trim() || null : null,
    porter_order_id: shipBy === 'by_porter' ? (body.porter_order_id || body.porterOrderId || '').trim() || null : null,
    porter_booking_url: shipBy === 'by_porter' ? (body.porter_booking_url || body.porterBookingUrl || '').trim() || null : null,
    delivery_person_id: shipBy === 'by_hand' && deliveryPersonId ? Number(deliveryPersonId) : null,
  };
}

async function nextVendorRepairDcNumber(client) {
  const fy = currentFinancialYearLabel();
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(dc_number, '/([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM vendor_repair_delivery_challans
      WHERE dc_number LIKE $1`,
    [`VRDC/${fy}/%`]
  );
  const seq = String(r.rows[0]?.n || 1).padStart(4, '0');
  return `VRDC/${fy}/${seq}`;
}

module.exports = {
  EWAY_VALUE_THRESHOLD,
  currentFinancialYearLabel,
  parseItemPrice,
  normalizeEwayBillNumber,
  requiresVrdcEway,
  validateEwayForConsignment,
  saveEsign,
  saveDispatchPod,
  normalizeShipBy,
  shipByToDispatchMode,
  validateDispatchDetails,
  dispatchPayloadFromBody,
  nextVendorRepairDcNumber,
  inferBrandFromModel,
  resolveVrdcItemSpecs,
  buildVrdcConfigurationString,
  enrichVrdcItemRow,
};
