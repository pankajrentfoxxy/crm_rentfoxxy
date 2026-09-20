'use strict';

/**
 * Who delivery OTP / delivery-confirmation mail goes to, and from which mailbox.
 *
 * These used to be sent from SMTP_USER *to* SMTP_USER — sales@rentfoxxy.com mailing
 * itself on every dispatch, which buried the sales inbox. They now go out from the
 * no-reply mailbox (the 'dispatch' transport) and the internal copy lands there too,
 * with admin on CC.
 *
 * Both are overridable so the addresses can move without a deploy:
 *   DELIVERY_NOTIFY_EMAIL     — the internal recipient
 *   DELIVERY_NOTIFY_CC        — comma-separated CC list
 */
const { getFromAddress } = require('../services/mailTransport');

/** The no-reply mailbox delivery mail is sent from. */
function deliveryMailFrom() {
  return getFromAddress('dispatch') || process.env.DISPATCH_SMTP_FROM || null;
}

/** Internal mailbox that keeps a copy of OTP / delivery-confirmation mail. */
function deliveryNotifyTo() {
  return String(process.env.DELIVERY_NOTIFY_EMAIL || '').trim()
    || deliveryMailFrom()
    || null;
}

/** CC on every OTP / delivery-confirmation mail, customer-facing ones included. */
function deliveryNotifyCc() {
  const raw = process.env.DELIVERY_NOTIFY_CC !== undefined
    ? process.env.DELIVERY_NOTIFY_CC
    : 'adminn@rentfoxxy.com';
  const list = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list.join(', ') : undefined;
}

module.exports = { deliveryMailFrom, deliveryNotifyTo, deliveryNotifyCc };
