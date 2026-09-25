/**
 * Dispatch team outbound mail — separate SMTP from the main CRM mailer.
 * Configure via DISPATCH_SMTP_* in backend/.env (not SMTP_*).
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { USER_TRIGGERED } = require('./outboundMessagingGuard');

function getDispatchMailTransport() {
  const host = process.env.DISPATCH_SMTP_HOST;
  const user = process.env.DISPATCH_SMTP_USER;
  const pass = process.env.DISPATCH_SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.DISPATCH_SMTP_PORT || '587', 10);
  const secure = String(process.env.DISPATCH_SMTP_SECURE || 'false').toLowerCase() === 'true';
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

function getDispatchFromAddress() {
  return process.env.DISPATCH_SMTP_FROM
    || process.env.DISPATCH_SMTP_USER
    || null;
}

function isDispatchMailConfigured() {
  return Boolean(getDispatchMailTransport() && getDispatchFromAddress());
}

/**
 * Send email using the dispatch SMTP account only.
 * @returns {Promise<boolean>}
 */
/**
 * `userTriggered`: the mail was sent from a Send/Resend button, so the outbound kill
 * switch lets it through (internal recipients only -- see outboundMessagingGuard).
 */
async function sendDispatchMail({
  to, subject, text, html, pdfRelativePath, cc, replyTo, extraAttachments = [], userTriggered = false,
}) {
  const transport = getDispatchMailTransport();
  const from = getDispatchFromAddress();
  if (!transport || !from || !to) return false;

  const abs = pdfRelativePath ? path.join(__dirname, '..', pdfRelativePath) : null;
  const attachments = [];
  if (Array.isArray(extraAttachments)) {
    for (const item of extraAttachments) {
      if (item?.path && fs.existsSync(item.path)) attachments.push(item);
    }
  }
  if (abs && fs.existsSync(abs)) {
    attachments.push({ filename: path.basename(abs), path: abs });
  }
  const mail = {
    from,
    to,
    subject,
    text,
    attachments,
  };
  if (html) mail.html = html;
  if (cc) mail.cc = cc;
  if (replyTo) mail.replyTo = replyTo;
  if (userTriggered) mail[USER_TRIGGERED] = true;

  await transport.sendMail(mail);
  return true;
}

module.exports = {
  getDispatchMailTransport,
  getDispatchFromAddress,
  isDispatchMailConfigured,
  sendDispatchMail,
};
