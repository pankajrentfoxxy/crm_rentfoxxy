/**
 * Named SMTP transports.
 *
 * The CRM has more than one sending identity. Quotations go to customers and are
 * sent from a no-reply mailbox; the dispatch team has its own account; everything
 * else uses the general CRM mailer.
 *
 * Each name resolves through a fallback chain, so a deployment only has to set the
 * accounts it actually has:
 *
 *   quotation -> QUOTATION_SMTP_* -> DISPATCH_SMTP_* -> SMTP_*
 *   dispatch  -> DISPATCH_SMTP_*  -> SMTP_*
 *   default   -> SMTP_*
 *
 * The From address is resolved separately, because it is not always the login:
 * QUOTATION_FROM wins for quotations, then the chain's authenticated user. Note
 * that most providers reject or silently rewrite a From that is not the
 * authenticated mailbox or a verified alias of it, so prefer to move the whole
 * transport rather than only the From address.
 */
const nodemailer = require('nodemailer');
const { exemptFromGuard } = require('./outboundMessagingGuard');

function buildFromPrefix(prefix) {
  const host = process.env[`${prefix}HOST`];
  const user = process.env[`${prefix}USER`];
  const pass = process.env[`${prefix}PASS`];
  if (!host || !user || !pass) return null;
  return {
    user,
    transport: nodemailer.createTransport({
      host,
      port: parseInt(process.env[`${prefix}PORT`] || '587', 10),
      secure: String(process.env[`${prefix}SECURE`] || 'false').toLowerCase() === 'true',
      auth: { user, pass },
    }),
  };
}

const CHAINS = Object.freeze({
  quotation: ['QUOTATION_SMTP_', 'DISPATCH_SMTP_', 'SMTP_'],
  dispatch: ['DISPATCH_SMTP_', 'SMTP_'],
  default: ['SMTP_'],
});

/** First configured account in the chain, as { user, transport }, or null. */
function resolveMailer(name = 'default') {
  for (const prefix of (CHAINS[name] || CHAINS.default)) {
    const built = buildFromPrefix(prefix);
    if (built) return built;
  }
  return null;
}

function getTransport(name = 'default') {
  const transport = resolveMailer(name)?.transport || null;
  // Quotations must keep reaching customers while other outbound mail is blocked.
  return name === 'quotation' ? exemptFromGuard(transport) : transport;
}

/** Explicit override first, then the mailbox we actually authenticate as. */
function getFromAddress(name = 'default') {
  const overrides = {
    quotation: process.env.QUOTATION_FROM,
    dispatch: process.env.DISPATCH_SMTP_FROM,
    default: process.env.EMAIL_FROM,
  };
  return overrides[name] || resolveMailer(name)?.user || null;
}

function isConfigured(name = 'default') {
  return Boolean(resolveMailer(name));
}

module.exports = { getTransport, getFromAddress, isConfigured, resolveMailer };
