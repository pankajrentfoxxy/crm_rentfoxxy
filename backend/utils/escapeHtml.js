/**
 * Escape a value for interpolation into an HTML email body.
 *
 * Several senders interpolated user-controlled text raw — lead name and company
 * name (both settable from the PUBLIC web form and ingested by the IMAP worker),
 * and customer name. A lead whose company name is
 * `<a href="http://evil/">Click to verify</a>` then renders as a working link in
 * the reminder email to the assigned rep, carrying a legitimate internal From:
 * address. leadQuotationService already had a local copy of this; this is the
 * shared one so every sender can use the same thing.
 *
 * Also escapes the single quote, which the original local copy did not — it
 * matters inside single-quoted attribute values.
 */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { escapeHtml };
