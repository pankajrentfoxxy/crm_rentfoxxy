const nodemailer = require('nodemailer');

function smtpTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

/**
 * Notify assigned technician when a ticket is highlighted (QC fail).
 */
async function sendHighlightedTicketAlert({
  technicianEmail,
  technicianName,
  ttsplId,
  ticketId,
  reason
}) {
  if (!technicianEmail) return { sent: false, reason: 'no_email' };
  const transport = smtpTransport();
  if (!transport) {
    console.warn('[highlightedTicket] SMTP not configured — skipping alert');
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const ticketUrl = `${frontendUrl.replace(/\/$/, '')}/floor-pipeline/tickets/${ticketId}`;
  const subject = `⚠ Ticket ${ttsplId || ticketId} needs your attention — ${reason || 'QC failed'}`;
  const html = `
    <p>Hi ${technicianName || 'Technician'},</p>
    <p>A floor ticket needs your attention:</p>
    <ul>
      <li><strong>TTSPL:</strong> ${ttsplId || '—'}</li>
      <li><strong>Ticket ID:</strong> #${ticketId}</li>
      <li><strong>Reason:</strong> ${reason || 'QC failed — please review'}</li>
    </ul>
    <p><a href="${ticketUrl}">Open ticket in CRM</a></p>
  `;

  await transport.sendMail({
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to: technicianEmail,
    subject,
    html
  });
  return { sent: true };
}

module.exports = { sendHighlightedTicketAlert };
