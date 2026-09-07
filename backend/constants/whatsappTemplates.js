/**
 * CRM event keys vs live Interakt template names.
 *
 * Interakt dashboard (en) currently has:
 *   create_so
 *   order_intrasit_vd
 *   otp_verification
 *   order_delivered
 *   support_ticket_created_
 *   support_pickup_scheduled
 *   support_picked_up
 *   support_replacement_created_
 *   support_service_in_transit
 *   support_service_delivered
 *
 * Trailing underscores on support_ticket_created_ / support_replacement_created_
 * are the live Interakt names. OTP for support reuses otp_verification.
 */
function envName(key, fallback) {
  const v = String(process.env[key] || '').trim();
  return v || fallback;
}

const TEMPLATES = Object.freeze({
  so_created_v1: {
    key: 'so_created_v1',
    interaktName: envName('INTERAKT_TPL_SO_CREATED', 'create_so'),
    aliases: ['create_so', 'so_created_v1'],
    eventType: 'so_created',
    varCount: 4,
    fields: ['customer_name', 'order_no', 'order_type', 'quantity'],
  },
  so_in_transit_v1: {
    key: 'so_in_transit_v1',
    interaktName: envName('INTERAKT_TPL_SO_IN_TRANSIT', 'order_intrasit_vd'),
    aliases: ['so_in_transit_v1', 'order_intrasit_vd', 'order_intrasit'],
    eventType: 'so_in_transit',
    varCount: 4,
    fields: ['customer_name', 'order_no', 'dc_no', 'quantity'],
  },
  delivery_otp_v1: {
    key: 'delivery_otp_v1',
    interaktName: envName('INTERAKT_TPL_DELIVERY_OTP', 'otp_verification'),
    aliases: ['otp_verification', 'delivery_otp_v1'],
    eventType: 'delivery_otp',
    varCount: 1,
    fields: ['otp'],
    copyOtpToButton: true,
  },
  so_delivered_v1: {
    key: 'so_delivered_v1',
    interaktName: envName('INTERAKT_TPL_SO_DELIVERED', 'order_delivered'),
    aliases: ['order_delivered', 'so_delivered_v1'],
    eventType: 'so_delivered',
    varCount: 5,
    fields: ['customer_name', 'order_no', 'dc_no', 'quantity', 'date'],
  },
  support_ticket_created_v1: {
    key: 'support_ticket_created_v1',
    interaktName: envName('INTERAKT_TPL_SUPPORT_TICKET_CREATED', 'support_ticket_created_'),
    aliases: ['support_ticket_created_', 'support_ticket_created', 'support_ticket_created_v1'],
    eventType: 'support_ticket_created',
    varCount: 3,
    fields: ['customer_name', 'ticket_no', 'ticket_type'],
  },
  support_pickup_scheduled_v1: {
    key: 'support_pickup_scheduled_v1',
    interaktName: envName('INTERAKT_TPL_SUPPORT_PICKUP_SCHEDULED', 'support_pickup_scheduled'),
    aliases: ['support_pickup_scheduled', 'support_pickup_scheduled_v1'],
    eventType: 'support_pickup_scheduled',
    varCount: 4,
    fields: ['customer_name', 'rdc_no', 'quantity', 'assigned_to'],
  },
  support_picked_up_v1: {
    key: 'support_picked_up_v1',
    interaktName: envName('INTERAKT_TPL_SUPPORT_PICKED_UP', 'support_picked_up'),
    aliases: ['support_picked_up', 'support_picked_up_v1'],
    eventType: 'support_picked_up',
    varCount: 4,
    fields: ['customer_name', 'rdc_no', 'quantity', 'date'],
  },
  support_replacement_created_v1: {
    key: 'support_replacement_created_v1',
    interaktName: envName('INTERAKT_TPL_SUPPORT_REPLACEMENT_CREATED', 'support_replacement_created_'),
    aliases: ['support_replacement_created_', 'support_replacement_created', 'support_replacement_created_v1'],
    eventType: 'support_replacement_created',
    varCount: 4,
    fields: ['customer_name', 'order_no', 'quantity', 'ticket_no'],
  },
  support_service_in_transit_v1: {
    key: 'support_service_in_transit_v1',
    interaktName: envName('INTERAKT_TPL_SUPPORT_SERVICE_IN_TRANSIT', 'support_service_in_transit'),
    aliases: ['support_service_in_transit', 'support_service_in_transit_v1'],
    eventType: 'support_service_in_transit',
    varCount: 4,
    fields: ['customer_name', 'ticket_no', 'sdc_no', 'quantity'],
  },
  support_service_delivered_v1: {
    key: 'support_service_delivered_v1',
    interaktName: envName('INTERAKT_TPL_SUPPORT_SERVICE_DELIVERED', 'support_service_delivered'),
    aliases: ['support_service_delivered', 'support_service_delivered_v1'],
    eventType: 'support_service_delivered',
    varCount: 5,
    fields: ['customer_name', 'ticket_no', 'sdc_no', 'quantity', 'date'],
  },
});

function resolveTemplate(templateName) {
  const name = String(templateName || '').trim();
  if (TEMPLATES[name]) return TEMPLATES[name];
  return Object.values(TEMPLATES).find(
    (t) => t.interaktName === name || (t.aliases || []).includes(name)
  ) || null;
}

const TEMPLATE_NAMES = Object.freeze(Object.keys(TEMPLATES));

module.exports = {
  TEMPLATES,
  TEMPLATE_NAMES,
  resolveTemplate,
};
