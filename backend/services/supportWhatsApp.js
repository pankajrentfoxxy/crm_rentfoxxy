/**
 * Support-ticket WhatsApp events (Interakt templates).
 *
 * Call the *Async helpers after COMMIT. OTP reuses the live SO delivery
 * template otp_verification (delivery_otp_v1).
 */
const pool = require('../config/db');
const logger = require('../utils/logger');
const { normalizeIndianMobile } = require('../utils/phoneValidation');
const {
  sendWhatsAppTemplate,
  fireAndForget,
  formatDdMmYyyy,
} = require('./interaktWhatsAppService');

function formatTicketNo(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `T-${n}`;
}

function formatTicketType(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (t === 'pickup') return 'Pickup';
  if (t === 'replacement') return 'Replacement';
  return 'Complaint';
}

function displayCustomerName(row) {
  const ticketName = String(row.customer_name || '').trim();
  const person = String(row.cust_name || '').trim();
  const company = String(row.company_name || '').trim();
  if (person && company && ticketName === company && person !== company) return person;
  return ticketName || person || company;
}

function formatQty(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '';
  return String(Number.isInteger(num) ? num : Math.round(num));
}

function phoneFromJson(raw) {
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

function isCourierOrPorter(method) {
  const m = String(method || '').toLowerCase();
  return m === 'courier' || m === 'porter';
}

function assignedLabel(row) {
  const method = String(row.pickup_method || '').toLowerCase();
  if (method === 'courier') {
    return String(row.pickup_courier_name || 'Courier').trim();
  }
  if (method === 'porter') {
    return String(row.porter_tracking_id || row.porter_order_id || 'Porter').trim();
  }
  return String(row.assignee_name || '').trim();
}

function isServiceReturnDc(row) {
  return String(row.dc_purpose || '').toLowerCase() === 'service_return';
}

async function loadTicketContext(ticketId) {
  const r = await pool.query(
    `SELECT
        t.id,
        t.customer_id,
        t.customer_name,
        t.customer_phone,
        t.ticket_phone_override,
        t.ticket_alt_phone,
        t.ticket_category,
        t.return_dc_number,
        t.sales_order_number,
        t.pickup_address,
        c.phone AS customer_table_phone,
        c.whatsapp_number,
        c.name AS cust_name,
        c.company_name
       FROM support_tickets t
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE t.id = $1
      LIMIT 1`,
    [ticketId]
  );
  return r.rows[0] || null;
}

async function loadPickupContext(ticketId, rdcNumber) {
  const r = await pool.query(
    `SELECT
        t.id AS ticket_id,
        t.customer_id,
        t.customer_name,
        t.customer_phone,
        t.ticket_phone_override,
        t.ticket_alt_phone,
        t.ticket_category,
        t.pickup_address,
        c.phone AS customer_table_phone,
        c.whatsapp_number,
        c.name AS cust_name,
        c.company_name,
        pu.return_dc_number,
        pu.pickup_method,
        pu.pickup_courier_name,
        pu.porter_tracking_id,
        pu.porter_order_id,
        pu.customer_otp_code,
        pu.otp_code,
        COALESCE(u1.name, u2.name) AS assignee_name,
        (
          SELECT COUNT(*)::int
            FROM support_ticket_items i
           WHERE i.item_type = 'pickup'
             AND COALESCE(i.status, '') <> 'cancelled'
             AND (
               ($2::text IS NOT NULL AND i.return_dc_number = $2)
               OR ($2::text IS NULL AND i.ticket_id = t.id)
             )
        ) AS pickup_qty
       FROM support_tickets t
       LEFT JOIN customers c ON c.customer_id = t.customer_id
       LEFT JOIN LATERAL (
         SELECT *
           FROM support_ticket_items
          WHERE ticket_id = t.id
            AND item_type = 'pickup'
            AND COALESCE(status, '') <> 'cancelled'
            AND ($2::text IS NULL OR return_dc_number = $2)
          ORDER BY id DESC
          LIMIT 1
       ) pu ON true
       LEFT JOIN users u1 ON u1.user_id = pu.pickup_assigned_to
       LEFT JOIN users u2 ON u2.user_id = pu.assigned_to
      WHERE t.id = $1
      LIMIT 1`,
    [ticketId, rdcNumber || null]
  );
  return r.rows[0] || null;
}

async function loadServiceDcContext(dcNumber) {
  const r = await pool.query(
    `SELECT
        dcl.dc_number,
        MAX(dcl.dc_purpose) AS dc_purpose,
        MAX(dcl.support_ticket_id) AS support_ticket_id,
        MAX(dcl.customer_name) AS customer_name,
        MAX(dcl.customer_id) AS customer_id,
        MAX(dcl.d_customer_mobile) AS d_customer_mobile,
        MAX(dcl.customer_shipping_address::text) AS shipping,
        SUM(COALESCE(dcl.quantity, 1))::numeric AS quantity
       FROM delivery_challan_lines dcl
      WHERE dcl.dc_number = $1
      GROUP BY dcl.dc_number`,
    [dcNumber]
  );
  return r.rows[0] || null;
}

async function resolveTicketPhone(row, extraPhone) {
  return firstValidPhone(
    extraPhone,
    row.ticket_phone_override,
    row.customer_phone,
    phoneFromJson(row.pickup_address),
    row.d_customer_mobile,
    phoneFromJson(row.shipping),
    row.whatsapp_number,
    row.customer_table_phone,
    row.ticket_alt_phone
  );
}

async function notifySupportTicketCreated({ ticketId, phone } = {}) {
  try {
    if (!ticketId) return { ok: false, skipped: true, error: 'missing ticketId' };
    const ticket = await loadTicketContext(ticketId);
    if (!ticket) return { ok: false, skipped: true, error: 'ticket not found' };
    const name = displayCustomerName(ticket);
    const ticketNo = formatTicketNo(ticket.id);
    if (!name || !ticketNo) {
      return { ok: false, skipped: true, error: 'missing customer_name or ticket number' };
    }
    return await sendWhatsAppTemplate({
      phone: await resolveTicketPhone(ticket, phone),
      templateName: 'support_ticket_created_v1',
      values: [name, ticketNo, formatTicketType(ticket.ticket_category)],
      refType: 'support_ticket',
      refId: ticketNo,
    });
  } catch (err) {
    logger.error({ err: err.message, ticketId }, 'notifySupportTicketCreated failed');
    return { ok: false, error: err.message };
  }
}

async function notifySupportPickupScheduled({ ticketId, rdcNumber, phone } = {}) {
  try {
    if (!ticketId) return { ok: false, skipped: true, error: 'missing ticketId' };
    const ctx = await loadPickupContext(ticketId, rdcNumber);
    if (!ctx) return { ok: false, skipped: true, error: 'ticket not found' };
    const rdc = String(rdcNumber || ctx.return_dc_number || '').trim();
    const name = displayCustomerName(ctx);
    const qty = formatQty(ctx.pickup_qty);
    const assigned = assignedLabel(ctx);
    if (!rdc || !name || !qty || !assigned) {
      return { ok: false, skipped: true, error: 'missing rdc, name, quantity, or assignee' };
    }
    return await sendWhatsAppTemplate({
      phone: await resolveTicketPhone(ctx, phone),
      templateName: 'support_pickup_scheduled_v1',
      values: [name, rdc, qty, assigned],
      refType: 'return_dc',
      refId: rdc,
    });
  } catch (err) {
    logger.error({ err: err.message, ticketId, rdcNumber }, 'notifySupportPickupScheduled failed');
    return { ok: false, error: err.message };
  }
}

async function notifySupportPickedUp({ ticketId, rdcNumber, phone, pickedUpOn } = {}) {
  try {
    if (!ticketId) return { ok: false, skipped: true, error: 'missing ticketId' };
    const ctx = await loadPickupContext(ticketId, rdcNumber);
    if (!ctx) return { ok: false, skipped: true, error: 'ticket not found' };
    const rdc = String(rdcNumber || ctx.return_dc_number || '').trim();
    const name = displayCustomerName(ctx);
    const qty = formatQty(ctx.pickup_qty);
    const dateStr = formatDdMmYyyy(pickedUpOn || new Date());
    if (!rdc || !name || !qty || !dateStr) {
      return { ok: false, skipped: true, error: 'missing rdc, name, quantity, or date' };
    }
    return await sendWhatsAppTemplate({
      phone: await resolveTicketPhone(ctx, phone),
      templateName: 'support_picked_up_v1',
      values: [name, rdc, qty, dateStr],
      refType: 'return_dc',
      refId: `${rdc}:picked_up`,
    });
  } catch (err) {
    logger.error({ err: err.message, ticketId, rdcNumber }, 'notifySupportPickedUp failed');
    return { ok: false, error: err.message };
  }
}

async function notifySupportReplacementCreated({ ticketId, salesOrderNumber, quantity, phone } = {}) {
  try {
    if (!ticketId) return { ok: false, skipped: true, error: 'missing ticketId' };
    const ticket = await loadTicketContext(ticketId);
    if (!ticket) return { ok: false, skipped: true, error: 'ticket not found' };
    const so = String(salesOrderNumber || ticket.sales_order_number || '').trim();
    const name = displayCustomerName(ticket);
    const ticketNo = formatTicketNo(ticket.id);
    let qty = formatQty(quantity);
    if (!qty) {
      const c = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM support_ticket_items
          WHERE ticket_id = $1 AND item_type = 'replacement'
            AND COALESCE(status, '') <> 'cancelled'`,
        [ticketId]
      );
      qty = formatQty(c.rows[0]?.n);
    }
    if (!name || !so || !qty || !ticketNo) {
      return { ok: false, skipped: true, error: 'missing name, SO, quantity, or ticket number' };
    }
    return await sendWhatsAppTemplate({
      phone: await resolveTicketPhone(ticket, phone),
      templateName: 'support_replacement_created_v1',
      values: [name, so, qty, ticketNo],
      refType: 'sales_order',
      refId: so,
      salesOrderNumber: so,
    });
  } catch (err) {
    logger.error({ err: err.message, ticketId }, 'notifySupportReplacementCreated failed');
    return { ok: false, error: err.message };
  }
}

async function notifySupportServiceInTransit({ dcNumber, phone } = {}) {
  try {
    if (!dcNumber) return { ok: false, skipped: true, error: 'missing dcNumber' };
    const dc = await loadServiceDcContext(dcNumber);
    if (!dc) return { ok: false, skipped: true, error: 'service DC not found' };
    if (!isServiceReturnDc(dc)) return { ok: false, skipped: true, error: 'not a service DC' };
    const ticketNo = formatTicketNo(dc.support_ticket_id);
    const name = String(dc.customer_name || '').trim();
    const qty = formatQty(dc.quantity);
    if (!name || !ticketNo || !qty) {
      return { ok: false, skipped: true, error: 'missing name, ticket, or quantity' };
    }
    let ticketPhone = phone;
    if (dc.support_ticket_id) {
      const ticket = await loadTicketContext(dc.support_ticket_id);
      if (ticket) ticketPhone = await resolveTicketPhone({ ...dc, ...ticket }, phone);
    }
    return await sendWhatsAppTemplate({
      phone: ticketPhone || (await resolveTicketPhone(dc, phone)),
      templateName: 'support_service_in_transit_v1',
      values: [name, ticketNo, dc.dc_number, qty],
      refType: 'service_dc',
      refId: dc.dc_number,
      dcNumber: dc.dc_number,
    });
  } catch (err) {
    logger.error({ err: err.message, dcNumber }, 'notifySupportServiceInTransit failed');
    return { ok: false, error: err.message };
  }
}

async function notifySupportServiceDelivered({ dcNumber, phone, deliveredOn } = {}) {
  try {
    if (!dcNumber) return { ok: false, skipped: true, error: 'missing dcNumber' };
    const dc = await loadServiceDcContext(dcNumber);
    if (!dc) return { ok: false, skipped: true, error: 'service DC not found' };
    if (!isServiceReturnDc(dc)) return { ok: false, skipped: true, error: 'not a service DC' };
    const ticketNo = formatTicketNo(dc.support_ticket_id);
    const name = String(dc.customer_name || '').trim();
    const qty = formatQty(dc.quantity);
    const dateStr = formatDdMmYyyy(deliveredOn || new Date());
    if (!name || !ticketNo || !qty || !dateStr) {
      return { ok: false, skipped: true, error: 'missing name, ticket, quantity, or date' };
    }
    let ticketPhone = phone;
    if (dc.support_ticket_id) {
      const ticket = await loadTicketContext(dc.support_ticket_id);
      if (ticket) ticketPhone = await resolveTicketPhone({ ...dc, ...ticket }, phone);
    }
    return await sendWhatsAppTemplate({
      phone: ticketPhone || (await resolveTicketPhone(dc, phone)),
      templateName: 'support_service_delivered_v1',
      values: [name, ticketNo, dc.dc_number, qty, dateStr],
      refType: 'service_dc',
      refId: `${dc.dc_number}:delivered`,
      dcNumber: dc.dc_number,
    });
  } catch (err) {
    logger.error({ err: err.message, dcNumber }, 'notifySupportServiceDelivered failed');
    return { ok: false, error: err.message };
  }
}

async function notifySupportOtp({ itemId, otp, phone } = {}) {
  try {
    if (!itemId && !otp) return { ok: false, skipped: true, error: 'missing itemId or otp' };
    let code = otp ? String(otp).trim() : '';
    let resolvedPhone = phone;
    let ticketId = null;
    if (itemId) {
      const itemRes = await pool.query(
        `SELECT i.id, i.ticket_id, i.item_type, i.pickup_method,
                COALESCE(i.customer_otp_code, i.otp_code) AS otp_code
           FROM support_ticket_items i
          WHERE i.id = $1`,
        [itemId]
      );
      const item = itemRes.rows[0];
      if (!item) return { ok: false, skipped: true, error: 'item not found' };
      if (item.item_type === 'pickup' && isCourierOrPorter(item.pickup_method)) {
        return { ok: false, skipped: true, error: 'courier/porter pickup has no customer OTP' };
      }
      ticketId = item.ticket_id;
      code = code || String(item.otp_code || '').trim();
      const ticket = await loadTicketContext(item.ticket_id);
      if (ticket) resolvedPhone = await resolveTicketPhone(ticket, phone);
      await pool.query(
        `UPDATE support_ticket_items SET customer_otp_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [itemId]
      );
    }
    if (!code) return { ok: false, skipped: true, error: 'missing otp' };
    const { notifyDeliveryOtp } = require('./salesOrderWhatsApp');
    return await notifyDeliveryOtp({ otp: code, phone: resolvedPhone });
  } catch (err) {
    logger.error({ err: err.message, itemId, ticketId }, 'notifySupportOtp failed');
    return { ok: false, error: err.message };
  }
}

function notifySupportTicketCreatedAsync(args) {
  fireAndForget(() => notifySupportTicketCreated(args), 'support_ticket_created_v1');
}

function notifySupportPickupScheduledAsync(args) {
  fireAndForget(() => notifySupportPickupScheduled(args), 'support_pickup_scheduled_v1');
}

function notifySupportPickedUpAsync(args) {
  fireAndForget(() => notifySupportPickedUp(args), 'support_picked_up_v1');
}

function notifySupportReplacementCreatedAsync(args) {
  fireAndForget(() => notifySupportReplacementCreated(args), 'support_replacement_created_v1');
}

function notifySupportServiceInTransitAsync(args) {
  fireAndForget(() => notifySupportServiceInTransit(args), 'support_service_in_transit_v1');
}

function notifySupportServiceDeliveredAsync(args) {
  fireAndForget(() => notifySupportServiceDelivered(args), 'support_service_delivered_v1');
}

function notifySupportOtpAsync(args) {
  fireAndForget(() => notifySupportOtp(args), 'delivery_otp_v1');
}

module.exports = {
  formatTicketNo,
  formatTicketType,
  displayCustomerName,
  formatQty,
  assignedLabel,
  isCourierOrPorter,
  notifySupportTicketCreated,
  notifySupportPickupScheduled,
  notifySupportPickedUp,
  notifySupportReplacementCreated,
  notifySupportServiceInTransit,
  notifySupportServiceDelivered,
  notifySupportOtp,
  notifySupportTicketCreatedAsync,
  notifySupportPickupScheduledAsync,
  notifySupportPickedUpAsync,
  notifySupportReplacementCreatedAsync,
  notifySupportServiceInTransitAsync,
  notifySupportServiceDeliveredAsync,
  notifySupportOtpAsync,
};
