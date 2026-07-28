/**
 * Dispatch team outbound mail — separate SMTP from the main CRM mailer.
 * Configure via DISPATCH_SMTP_* in backend/.env (not SMTP_*).
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

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
async function sendDispatchMail({ to, subject, text, html, pdfRelativePath, cc, replyTo }) {
  const transport = getDispatchMailTransport();
  const from = getDispatchFromAddress();
  if (!transport || !from || !to) return false;

  const abs = pdfRelativePath ? path.join(__dirname, '..', pdfRelativePath) : null;
  const mail = {
    from,
    to,
    subject,
    text,
    attachments: abs && fs.existsSync(abs) ? [{ filename: path.basename(abs), path: abs }] : [],
  };
  if (html) mail.html = html;
  if (cc) mail.cc = cc;
  if (replyTo) mail.replyTo = replyTo;

  await transport.sendMail(mail);
  return true;
}

module.exports = {
  getDispatchMailTransport,
  getDispatchFromAddress,
  isDispatchMailConfigured,
  sendDispatchMail,
};
