/**
 * Emails a CRM user their own login details, from the no-reply mailbox
 * (the `credentials` transport in mailTransport.js).
 *
 * The credentials transport is exempt from the outbound kill switch: a new user
 * has to receive their login, and Forgot Password is useless if its code never
 * arrives. Only send mail here that goes to the account holder themselves.
 */
const { getTransport, getFromAddress } = require('./mailTransport');
const { escapeHtml } = require('../utils/escapeHtml');

const CRM_LOGIN_URL = process.env.CRM_LOGIN_URL || 'https://crm.rentfoxxy.com';

const wrapHtml = (inner) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
    ${inner}
    <p style="color: #64748b; font-size: 12px;">This is an automated message from a no-reply address. Please do not reply.</p>
    <p style="color: #64748b; font-size: 12px;">— Rentfoxxy Technologies</p>
  </div>
`;

async function sendCredentialsMail({ to, subject, text, html }) {
  const transport = getTransport('credentials');
  if (!transport) throw new Error('No SMTP account is configured for credential emails');
  const fromAddress = getFromAddress('credentials');
  await transport.sendMail({
    from: fromAddress ? `"Rentfoxxy CRM" <${fromAddress}>` : undefined,
    to,
    subject,
    text,
    html,
  });
}

/** Welcome mail with the login email and the password the admin entered. */
async function sendNewUserCredentialsEmail({ name, email, password }) {
  const subject = 'Your Rentfoxxy CRM login details';
  const text = [
    `Hello ${name || 'there'},`,
    '',
    'An account has been created for you on the Rentfoxxy CRM.',
    '',
    `Login URL: ${CRM_LOGIN_URL}`,
    `Email / Username: ${email}`,
    `Password: ${password}`,
    '',
    'Please sign in and change your password. If you forget it, use "Forgot Password" on the login page.',
    '',
    '— Rentfoxxy Technologies',
  ].join('\n');
  const html = wrapHtml(`
    <p>Hello ${escapeHtml(name || 'there')},</p>
    <p>An account has been created for you on the Rentfoxxy CRM.</p>
    <table style="border-collapse: collapse; margin: 12px 0;">
      <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Login URL</td>
          <td style="padding: 4px 0;"><a href="${escapeHtml(CRM_LOGIN_URL)}">${escapeHtml(CRM_LOGIN_URL)}</a></td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Email / Username</td>
          <td style="padding: 4px 0; font-weight: 600;">${escapeHtml(email)}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Password</td>
          <td style="padding: 4px 0; font-weight: 600; font-family: monospace;">${escapeHtml(password)}</td></tr>
    </table>
    <p>Please sign in and change your password. If you forget it, use <b>Forgot Password</b> on the login page.</p>
  `);
  await sendCredentialsMail({ to: email, subject, text, html });
}

/** Forgot Password: the one-time code that lets the user set a new password. */
async function sendPasswordResetOtpEmail({ name, email, otp, expiresInMinutes }) {
  const subject = 'Rentfoxxy password reset code';
  const text = [
    `Hello ${name || 'there'},`,
    '',
    `Your password reset verification code is: ${otp}`,
    `Email / Username: ${email}`,
    '',
    `This code expires in ${expiresInMinutes} minutes. Enter it on the Forgot Password screen with your new password.`,
    'If you did not request this, you can ignore this email.',
    '',
    '— Rentfoxxy Technologies',
  ].join('\n');
  const html = wrapHtml(`
    <p>Hello ${escapeHtml(name || 'there')},</p>
    <p>Use this verification code to reset the password for <b>${escapeHtml(email)}</b>:</p>
    <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${escapeHtml(otp)}</p>
    <p style="color: #64748b; font-size: 13px;">This code expires in ${expiresInMinutes} minutes. Enter it on the Forgot Password screen with your new password.</p>
    <p style="color: #64748b; font-size: 13px;">If you did not request this, you can ignore this email.</p>
  `);
  await sendCredentialsMail({ to: email, subject, text, html });
}

module.exports = { sendNewUserCredentialsEmail, sendPasswordResetOtpEmail };
