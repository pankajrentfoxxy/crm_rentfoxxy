/**
 * Sales-order WhatsApp events (Interakt templates).
 *
 * Call the *Async helpers after COMMIT so order/OTP/delivery never block or
 * fail because WhatsApp is down. Other CRM modules can reuse sendWhatsAppTemplate
 * or these loaders.
 */
const pool = require('../config/db');
const logger = require('../utils/logger');
const { normalizeIndianMobile } = require('../utils/phoneValidation');
const {
  sendWhatsAppTemplate,
  fireAndForget,
  formatDdMmYyyy,
} = require('./interaktWhatsAppService');

function formatOrderType(raw) {
  const t = String(raw || 'rental').trim().toLowerCase();
  if (t === 'sale' || t === 'sales') return 'Sale';
  if (t === 'demo') return 'Demo';
  if (t === 'replacement') return 'Replacement';
  return 'Rental';
}

function formatQty(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '';
  return String(Number.isInteger(num) ? num : Math.round(num));
}

function phoneFromShipping(raw) {
  if (!raw) return '';
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return ''; }
  }
  if (!obj || typeof obj !== 'object') return '';
  return obj.phone || obj.mobile || obj.employee_phone || obj.whatsapp_number || '';
}

function firstValidPhone(...candidates) {
  for (const c of candidates) {
    const digits = normalizeIndianMobile(c);
    if (digits.length === 10) return digits;
  }
  return '';
}

function isOutboundSalesDc(row) {
  const movement = String(row.movement_type || 'outbound').toLowerCase();
  if (movement === 'return') return false;
  const purpose = String(row.dc_purpose || '').toLowerCase();
  if (purpose === 'service_return' || purpose === 'service') return false;
  return true;
}

async function loadCustomerPhones(customerId) {
  if (!customerId) return {};
  try {
    const r = await pool.query(
      `SELECT phone, whatsapp_number FROM customers WHERE customer_id = $1 LIMIT 1`,
      [customerId]
    );
    return r.rows[0] || {};
  } catch (err) {
    logger.warn({ err: err.message, customerId }, 'WhatsApp customer phone lookup failed');
    return {};
  }
}

async function loadSalesOrderContext(salesOrderNumber) {
  const r = await pool.query(
    `SELECT
        sol.sales_order_number,
        MAX(sol.customer_name) AS customer_name,
        MAX(sol.customer_mobile) AS customer_mobile,
        MAX(sol.customer_id) AS customer_id,
        MAX(sol.quotation_type) AS quotation_type,
        MAX(sol.customer_shipping_address::text) AS shipping,
        SUM(COALESCE(sol.main_qty, sol.quantity, 0))::numeric AS quantity
       FROM sales_order_lines sol
      WHERE sol.sales_order_number = $1
      GROUP BY sol.sales_order_number`,
    [salesOrderNumber]
  );
  return r.rows[0] || null;
}

async function loadDcContext(dcNumber) {
  const r = await pool.query(
    `WITH dc AS (
        SELECT
            dcl.dc_number,
            MAX(dcl.sales_order_number) AS sales_order_number,
            MAX(dcl.customer_name) AS customer_name,
            MAX(dcl.d_customer_mobile) AS d_customer_mobile,
            MAX(dcl.customer_id) AS customer_id,
            MAX(dcl.movement_type) AS movement_type,
            MAX(dcl.dc_purpose) AS dc_purpose,
            MAX(dcl.customer_shipping_address::text) AS shipping,
            SUM(COALESCE(dcl.quantity, 0))::numeric AS quantity
          FROM delivery_challan_lines dcl
         WHERE dcl.dc_number = $1
         GROUP BY dcl.dc_number
      )
      SELECT dc.*, sol.customer_mobile
        FROM dc
        LEFT JOIN LATERAL (
          SELECT customer_mobile
            FROM sales_order_lines
           WHERE sales_order_number = dc.sales_order_number
           LIMIT 1
        ) sol ON true`,
    [dcNumber]
  );
  return r.rows[0] || null;
}

async function resolveSoPhone(so, extraPhone) {
  const cust = await loadCustomerPhones(so.customer_id);
  return firstValidPhone(
    extraPhone,
    so.customer_mobile,
    phoneFromShipping(so.shipping),
    cust.whatsapp_number,
    cust.phone
  );
}

async function resolveDcPhone(dc, extraPhone) {
  const cust = await loadCustomerPhones(dc.customer_id);
  return firstValidPhone(
    extraPhone,
    dc.d_customer_mobile,
    dc.customer_mobile,
    phoneFromShipping(dc.shipping),
    cust.whatsapp_number,
    cust.phone
  );
}

async function notifySoCreated({ salesOrderNumber, phone } = {}) {
  try {
    if (!salesOrderNumber) return { ok: false, skipped: true, error: 'missing salesOrderNumber' };
    const so = await loadSalesOrderContext(salesOrderNumber);
    if (!so) return { ok: false, skipped: true, error: 'sales order not found' };
    const qty = formatQty(so.quantity);
    const name = String(so.customer_name || '').trim();
    if (!name || !qty) {
      return { ok: false, skipped: true, error: 'missing customer_name or quantity' };
    }
    return await sendWhatsAppTemplate({
      phone: await resolveSoPhone(so, phone),
      templateName: 'so_created_v1',
      values: [name, so.sales_order_number, formatOrderType(so.quotation_type), qty],
      refType: 'sales_order',
      refId: so.sales_order_number,
      salesOrderNumber: so.sales_order_number,
    });
  } catch (err) {
    logger.error({ err: err.message, salesOrderNumber }, 'notifySoCreated failed');
    return { ok: false, error: err.message };
  }
}

async function notifySoInTransit({ dcNumber, phone } = {}) {
  try {
    if (!dcNumber) return { ok: false, skipped: true, error: 'missing dcNumber' };
    const dc = await loadDcContext(dcNumber);
    if (!dc) return { ok: false, skipped: true, error: 'delivery challan not found' };
    if (!isOutboundSalesDc(dc)) return { ok: false, skipped: true, error: 'not an outbound sales DC' };
    if (!dc.sales_order_number) return { ok: false, skipped: true, error: 'DC has no sales order' };
    const qty = formatQty(dc.quantity);
    const name = String(dc.customer_name || '').trim();
    if (!name || !qty) {
      return { ok: false, skipped: true, error: 'missing customer_name or quantity' };
    }
    return await sendWhatsAppTemplate({
      phone: await resolveDcPhone(dc, phone),
      templateName: 'so_in_transit_v1',
      values: [name, dc.sales_order_number, dc.dc_number, qty],
      refType: 'delivery_challan',
      refId: dc.dc_number,
      salesOrderNumber: dc.sales_order_number,
      dcNumber: dc.dc_number,
    });
  } catch (err) {
    logger.error({ err: err.message, dcNumber }, 'notifySoInTransit failed');
    return { ok: false, error: err.message };
  }
}

async function notifyDeliveryOtp({ dcNumber, otp, phone } = {}) {
  try {
    if (!otp) return { ok: false, skipped: true, error: 'missing otp' };
    let resolvedPhone = phone;
    let soNumber = null;
    if (dcNumber) {
      const dc = await loadDcContext(dcNumber);
      if (dc) {
        if (!isOutboundSalesDc(dc)) return { ok: false, skipped: true, error: 'not an outbound sales DC' };
        resolvedPhone = resolvedPhone || (await resolveDcPhone(dc, phone));
        soNumber = dc.sales_order_number || null;
      }
    }
    return await sendWhatsAppTemplate({
      phone: resolvedPhone,
      templateName: 'delivery_otp_v1',
      values: [String(otp).trim()],
      refType: dcNumber ? 'delivery_challan' : null,
      refId: dcNumber || null,
      salesOrderNumber: soNumber,
      dcNumber: dcNumber || null,
    });
  } catch (err) {
    logger.error({ err: err.message, dcNumber }, 'notifyDeliveryOtp failed');
    return { ok: false, error: err.message };
  }
}

async function notifySoDelivered({ dcNumber, phone, deliveredOn } = {}) {
  try {
    if (!dcNumber) return { ok: false, skipped: true, error: 'missing dcNumber' };
    const dc = await loadDcContext(dcNumber);
    if (!dc) return { ok: false, skipped: true, error: 'delivery challan not found' };
    if (!isOutboundSalesDc(dc)) return { ok: false, skipped: true, error: 'not an outbound sales DC' };
    if (!dc.sales_order_number) return { ok: false, skipped: true, error: 'DC has no sales order' };
    const qty = formatQty(dc.quantity);
    const name = String(dc.customer_name || '').trim();
    const dateStr = formatDdMmYyyy(deliveredOn || new Date());
    if (!name || !qty || !dateStr) {
      return { ok: false, skipped: true, error: 'missing customer_name, quantity, or date' };
    }
    return await sendWhatsAppTemplate({
      phone: await resolveDcPhone(dc, phone),
      templateName: 'so_delivered_v1',
      values: [name, dc.sales_order_number, dc.dc_number, qty, dateStr],
      refType: 'delivery_challan',
      refId: `${dc.dc_number}:delivered`,
      salesOrderNumber: dc.sales_order_number,
      dcNumber: dc.dc_number,
    });
  } catch (err) {
    logger.error({ err: err.message, dcNumber }, 'notifySoDelivered failed');
    return { ok: false, error: err.message };
  }
}

function notifySoCreatedAsync(args) {
  fireAndForget(() => notifySoCreated(args), 'so_created_v1');
}

function notifySoInTransitAsync(args) {
  fireAndForget(() => notifySoInTransit(args), 'so_in_transit_v1');
}

function notifyDeliveryOtpAsync(args) {
  fireAndForget(() => notifyDeliveryOtp(args), 'delivery_otp_v1');
}

function notifySoDeliveredAsync(args) {
  fireAndForget(() => notifySoDelivered(args), 'so_delivered_v1');
}

module.exports = {
  formatOrderType,
  formatQty,
  notifySoCreated,
  notifySoInTransit,
  notifyDeliveryOtp,
  notifySoDelivered,
  notifySoCreatedAsync,
  notifySoInTransitAsync,
  notifyDeliveryOtpAsync,
  notifySoDeliveredAsync,
};
