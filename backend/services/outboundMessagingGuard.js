/**
 * Global kill switch for outbound email.
 *
 * Several services build their own nodemailer transports, so instead of guarding
 * each call site this wraps nodemailer.createTransport itself: every transport
 * created anywhere in the process refuses to send while outbound messaging is off.
 *
 * Transports passed to exemptFromGuard() (the quotation mailer) keep sending.
 *
 * Off by default. Sending resumes only with OUTBOUND_MESSAGING_ENABLED=true in
 * backend/.env (and a restart). Must be required before any service creates a
 * transport — server.js loads it straight after dotenv.
 */
const nodemailer = require('nodemailer');

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
      if (isOutboundMessagingEnabled() || transport.__outboundExempt) return originalSendMail(mail, callback);
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

module.exports = { isOutboundMessagingEnabled, exemptFromGuard, DISABLED_MESSAGE };
