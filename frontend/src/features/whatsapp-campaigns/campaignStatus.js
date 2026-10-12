/** Display + allowed actions per campaign / contact status. Mirrors whatsappCampaignService. */

export const CAMPAIGN_STATUS = {
  DRAFT: { label: 'Draft', tone: 'gray' },
  READY: { label: 'Ready', tone: 'blue' },
  QUEUED: { label: 'Queued', tone: 'purple' },
  PROCESSING: { label: 'Sending', tone: 'amber' },
  PAUSED: { label: 'Paused', tone: 'orange' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  FAILED: { label: 'Failed', tone: 'red' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
};

export const CONTACT_STATUS = {
  PENDING: { label: 'Pending', tone: 'gray' },
  QUEUED: { label: 'Queued', tone: 'purple' },
  SENDING: { label: 'Sending', tone: 'amber' },
  SENT: { label: 'Sent', tone: 'blue' },
  DELIVERED: { label: 'Delivered', tone: 'green' },
  READ: { label: 'Read', tone: 'green' },
  FAILED: { label: 'Failed', tone: 'red' },
  SKIPPED: { label: 'Skipped', tone: 'gray' },
};

/** Statuses during which the page should keep refreshing. */
export const ACTIVE_STATUSES = new Set(['QUEUED', 'PROCESSING']);

/**
 * Actions valid for a status, filtered by what the user may do.
 * perms: { canStart, canPause, canCancel }
 */
export function campaignActions(status, perms = {}) {
  const out = [];
  if (status === 'READY' && perms.canStart) out.push('start');
  if (['QUEUED', 'PROCESSING'].includes(status) && perms.canPause) out.push('pause');
  if (status === 'PAUSED' && perms.canStart) out.push('resume');
  if (['READY', 'QUEUED', 'PROCESSING', 'PAUSED'].includes(status) && perms.canCancel) out.push('cancel');
  return out;
}

export const isEditable = (status) => status === 'DRAFT' || status === 'READY';

/** Plain-language explanation of a send error for the contacts table. */
export function friendlyError(contact) {
  if (!contact) return '';
  const code = contact.error_code || '';
  const msg = contact.error_message || '';
  if (code === 'OUTCOME_UNKNOWN') return 'Not confirmed — the server stopped or timed out mid-send. Not resent, to avoid a duplicate.';
  if (code === 'CANCELLED') return 'Not sent — campaign was cancelled.';
  if (code === 'RATE_LIMITED') return 'Interakt rate limit — retried automatically.';
  if (code === 'VARIABLE_EMPTY') return msg;
  if (code === 'CHANNEL_FAILED') return `WhatsApp could not deliver: ${msg}`;
  if (/131053/.test(msg)) return 'Header image could not be downloaded by WhatsApp — check the media URL is public.';
  if (/132001|template.*not exist|template name/i.test(msg)) return 'Template not found — check the template name and language match Interakt.';
  if (/132000|parameter/i.test(msg)) return 'Template variables do not match the approved template.';
  if (/131026|not.*whatsapp|undeliverable/i.test(msg)) return 'This number is not on WhatsApp or cannot receive messages.';
  return msg;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const formatNumber = (n) => Number(n || 0).toLocaleString('en-IN');
