/**
 * Global kill switch for outbound email.
 *
 * Several services build their own nodemailer transports, so instead of guarding
 * each call site this wraps nodemailer.createTransport itself: every transport
 * created anywhere in the process refuses to send while outbound messaging is off.
 *
 * Transports passed to exemptFromGuard() (the quotation mailer) keep sending.
 *
 * A single mail flagged with USER_TRIGGERED (the "Send / Resend mail to Accounts"
 * buttons for e-way bill and invoice requests) also goes out, but only when every
 * recipient is an internal address -- a flagged mail can never reach a customer.
 *
 * Off by default. Sending resumes only with OUTBOUND_MESSAGING_ENABLED=true in
 * backend/.env (and a restart). Must be required before any service creates a
 * transport — server.js loads it straight after dotenv.
 *
 * Invoices to customers have their own switch. A mail flagged CUSTOMER_INVOICE is
 * blocked even while outbound messaging is on, unless
 * CUSTOMER_INVOICE_EMAIL_ENABLED=true.
 */
const nodemailer = require('nodemailer');

/** Set on a mail options object when a user clicked Send/Resend for it. */
const USER_TRIGGERED = Symbol('outboundUserTriggered');

/** Set on a mail options object that carries an invoice to a customer. */
const CUSTOMER_INVOICE = Symbol('outboundCustomerInvoice');

const CUSTOMER_INVOICE_DISABLED_MESSAGE =
  'Emailing invoices to customers is turned off (CUSTOMER_INVOICE_EMAIL_ENABLED is not true)';

function isCustomerInvoiceEmailEnabled() {
  return String(process.env.CUSTOMER_INVOICE_EMAIL_ENABLED || '').toLowerCase() === 'true';
}

const INTERNAL_DOMAINS =['rentfoxxy.com', 'truetechservices.in'];

function recipientAddresses(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(recipientAddresses);
  if (typeof value === 'object') return value.address ? [String(value.address)] : [];
  return String(value).split(/[,;]/).map((part) => {
    const angled = part.match(/<([^>]+)>/);
    return (angled ? angled[1] : part).trim();
  }).filter(Boolean);
}

function allRecipientsInternal(mail) {
  const addrs = recipientAddresses([mail?.to, mail?.cc, mail?.bcc]);
  return addrs.length > 0 && addrs.every((a) => {
    const domain = a.toLowerCase().split('@')[1];
    return INTERNAL_DOMAINS.includes(domain);
  });
}

const DISABLED_MESSAGE = 'Outbound messaging is disabled (OUTBOUND_MESSAGING_ENABLED is not true)';

function isOutboundMessagingEnabled() {
  return String(process.env.OUTBOUND_MESSAGING_ENABLED || '').toLowerCase() === 'true';
}

function install() {
  if (nodemailer.__outboundGuardInstalled) return;
  const originalCreateTransport = nodemailer.createTransport.bind(nodemailer);

  nodemailer.createTransport = (...args) => {
    const transport = originalCreateTransport(...args);
    const originalSendMail = transport.sendMail.bind(transport);
    transport.sendMail = (mail, callback) => {
      if (mail?.[CUSTOMER_INVOICE] && !isCustomerInvoiceEmailEnabled()) {
        console.warn(`[outboundGuard] blocked customer invoice email to "${mail?.to || ''}" subject "${mail?.subject || ''}"`);
        const err = new Error(CUSTOMER_INVOICE_DISABLED_MESSAGE);
        if (typeof callback === 'function') {
          process.nextTick(() => callback(err));
          return undefined;
        }
        return Promise.reject(err);
      }
      if (isOutboundMessagingEnabled() || transport.__outboundExempt) return originalSendMail(mail, callback);
      if (mail?.[USER_TRIGGERED] && allRecipientsInternal(mail)) return originalSendMail(mail, callback);
      const to = [mail?.to, mail?.cc, mail?.bcc].filter(Boolean).join(', ');
      console.warn(`[outboundGuard] blocked email to "${to}" subject "${mail?.subject || ''}"`);
      const err = new Error(DISABLED_MESSAGE);
      if (typeof callback === 'function') {
        process.nextTick(() => callback(err));
        return undefined;
      }
      return Promise.reject(err);
    };
    return transport;
  };
  nodemailer.__outboundGuardInstalled = true;
}

/** Let this transport send even while outbound messaging is off. */
function exemptFromGuard(transport) {
  if (transport) transport.__outboundExempt = true;
  return transport;
}

install();

module.exports = {
  isOutboundMessagingEnabled, exemptFromGuard, allRecipientsInternal, USER_TRIGGERED, DISABLED_MESSAGE,
  isCustomerInvoiceEmailEnabled, CUSTOMER_INVOICE, CUSTOMER_INVOICE_DISABLED_MESSAGE,
};
