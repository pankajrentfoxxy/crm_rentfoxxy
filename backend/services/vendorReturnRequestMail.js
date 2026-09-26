/**
 * Vendor return request (D10) — the rules and words, with no database access so
 * they can be tested on their own. See claude/carret-vendor-return-request.md.
 *
 * Dates are IST calendar days as 'YYYY-MM-DD' strings. "Rent stops from X"
 * means X is not billed: calcVendorLineAmount treats vendor_rent_end_date as
 * the last billed day, inclusive, so the stored end date is the day before.
 */
const { escapeHtml } = require('../utils/escapeHtml');

const REASONS = {
  customer_returned: {
    label: 'Returned by our customer',
    phrase: 'they have been returned by our customer and are no longer required for further deployment',
  },
  surplus: {
    label: 'Surplus to our requirement',
    phrase: 'they are surplus to our current requirement',
  },
  faulty: {
    label: 'Not working to the expected standard',
    phrase: 'they are not working to the expected standard and we do not wish to continue with them',
  },
  requirement_ended: {
    label: 'Rental requirement has ended',
    phrase: 'the requirement for which they were taken on rent has ended',
  },
  other: { label: 'Other', phrase: null },
};

const MAX_DAYS_AHEAD = 30;

const DEFAULT_CC = [
  'accounts@truetechservices.in',
  'pankkajyadav@rentfoxxy.com',
  'warehouse@rentfoxxy.com',
  'adminn@rentfoxxy.com',
];

const SIGN_OFF = 'TrueTech Services Pvt. Ltd.';

function requestCc() {
  const fromEnv = String(process.env.VENDOR_RETURN_REQUEST_CC || '').trim();
  return fromEnv || DEFAULT_CC.join(', ');
}

function todayIst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

function ymd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    // node-pg returns DATE columns as local-midnight Dates; read them back in the
    // same local calendar, not UTC, or the day shifts on a UTC+ server.
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const s = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function addDays(dateYmd, days) {
  const d = new Date(`${dateYmd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lastBilledDay(stopYmd) {
  return addDays(stopYmd, -1);
}

function prettyDate(value) {
  const s = ymd(value);
  if (!s) return '—';
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function prettyTime(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(value || '').trim() || null;
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${m[2]} ${suffix}`;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Checks the dates on a request. `rentStopDate` may be omitted (the old screen
 * does not send one — it then stops on the day the vendor is told).
 */
function validateRequestDates({ rentStopDate, pickupDate, pickupTime, today = todayIst() }) {
  const out = { rentStopDate: null, pickupDate: null, pickupTime: null };
  if (rentStopDate) {
    const s = ymd(rentStopDate);
    if (!s) throw badRequest('Rent stop date must be a date (YYYY-MM-DD)');
    if (s < today) throw badRequest(`Rent stop date can't be in the past — pick ${prettyDate(today)} or later`);
    if (s > addDays(today, MAX_DAYS_AHEAD)) {
      throw badRequest(`Rent stop date can be at most ${MAX_DAYS_AHEAD} days ahead`);
    }
    out.rentStopDate = s;
  }
  if (pickupDate) {
    const p = ymd(pickupDate);
    if (!p) throw badRequest('Pickup date must be a date (YYYY-MM-DD)');
    if (p < today) throw badRequest("Pickup date can't be in the past");
    out.pickupDate = p;
  }
  if (pickupTime) {
    const t = String(pickupTime).trim();
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw badRequest('Pickup time must be HH:MM');
    out.pickupTime = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  if (out.pickupTime && !out.pickupDate) throw badRequest('Give the pickup date with the time');
  return out;
}

function reasonText(reasonCode, returnReason) {
  const r = REASONS[reasonCode];
  if (r && r.phrase) return r.phrase;
  const free = String(returnReason || '').trim();
  return free ? `of the following reason: ${free}` : null;
}

function reasonLabel(reasonCode, returnReason) {
  const r = REASONS[reasonCode];
  if (reasonCode === 'other' || !r) return String(returnReason || '').trim() || null;
  return r.label;
}

const cell = 'padding:6px 8px;border:1px solid #d9dee5;font-size:13px;vertical-align:top';

function laptopTable(items) {
  const rows = items.map((r, i) => `
    <tr>
      <td style="${cell};text-align:right">${i + 1}</td>
      <td style="${cell};font-family:monospace">${escapeHtml(r.ttspl_id || '—')}</td>
      <td style="${cell};font-family:monospace">${escapeHtml(r.serial_number || '—')}</td>
      <td style="${cell}">${escapeHtml([r.brand, r.model].filter(Boolean).join(' ') || '—')}</td>
      <td style="${cell}">${escapeHtml(r.configuration || '—')}</td>
      <td style="${cell}">${escapeHtml(r.po_number || '—')}</td>
    </tr>`).join('');
  return `
    <table style="border-collapse:collapse;margin:8px 0 16px">
      <thead><tr style="background:#0e7490;color:#fff">
        <th style="${cell};text-align:right">#</th>
        <th style="${cell};text-align:left">TTSPL ID</th>
        <th style="${cell};text-align:left">Serial no.</th>
        <th style="${cell};text-align:left">Brand / model</th>
        <th style="${cell};text-align:left">Configuration</th>
        <th style="${cell};text-align:left">PO</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * The request mail. `ticket` needs ticket_number, vendor_name, reason_code,
 * return_reason, pickup_date, pickup_time, remarks; `stopDate` is the rent stop
 * date actually applied; `pickupAddress` is our warehouse block.
 */
function buildRequestMail({ ticket, items, stopDate, contactName, pickupAddress }) {
  const n = items.length;
  const units = n === 1 ? 'laptop' : 'laptops';
  const them = n === 1 ? 'it' : 'them';
  const greeting = contactName || ticket.vendor_name || 'Sir / Madam';
  const why = reasonText(ticket.reason_code, ticket.return_reason);
  const stop = prettyDate(stopDate);
  const lastDay = prettyDate(lastBilledDay(stopDate));
  const pickupWhen = ticket.pickup_date
    ? [prettyDate(ticket.pickup_date), prettyTime(ticket.pickup_time)].filter(Boolean).join(' at ')
    : null;
  const subject = `Return of ${n} rented ${units} — ${ticket.ticket_number} — ${SIGN_OFF}`;

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">
  <p>Dear ${escapeHtml(greeting)},</p>
  <p>Greetings from ${escapeHtml(SIGN_OFF)}.</p>
  <p>We are writing to let you know that we will not be using the ${n} ${units} listed below, taken on rent from ${escapeHtml(ticket.vendor_name || 'you')}${why ? `, as ${escapeHtml(why)}` : ''}. We would therefore like to return ${them} to you.</p>
  <p style="padding:10px 12px;background:#fff7ed;border-left:4px solid #ea580c">
    <strong>Rent stop:</strong> we are stopping the rent on ${n === 1 ? 'this laptop' : 'these laptops'} from <strong>${escapeHtml(stop)}</strong> onwards.
    Please raise your rental invoice for ${them} only up to <strong>${escapeHtml(lastDay)}</strong>.
  </p>
  <p><strong>Pickup:</strong> ${pickupWhen
    ? `the ${units} will be ready for pickup at our warehouse on <strong>${escapeHtml(pickupWhen)}</strong>.`
    : `the ${units} are ready for pickup at our warehouse.`}
    Please arrange the pickup and reply to this mail with the pickup person's name, phone number and vehicle number.
    If you would like us to send the ${units} to you instead, please let us know the date, time and address that suit you.</p>
  <p style="margin-bottom:4px"><strong>Pickup address</strong></p>
  <p style="margin-top:0;white-space:pre-line;color:#334155">${escapeHtml(pickupAddress || '')}</p>
  <p style="margin-bottom:0"><strong>${n} ${units} — request ${escapeHtml(ticket.ticket_number)}</strong></p>
  ${laptopTable(items)}
  ${ticket.remarks ? `<p><strong>Note:</strong> ${escapeHtml(ticket.remarks)}</p>` : ''}
  <p>The same details, with each laptop's configuration, are in the attached PDF.</p>
  <p>Thanks and Regards,<br/><strong>${escapeHtml(SIGN_OFF)}</strong></p>
</div>`;

  const text = [
    `Dear ${greeting},`,
    '',
    `Greetings from ${SIGN_OFF}.`,
    '',
    `We will not be using the ${n} ${units} listed below, taken on rent from ${ticket.vendor_name || 'you'}${why ? `, as ${why}` : ''}. We would like to return ${them} to you.`,
    '',
    `RENT STOP: we are stopping the rent from ${stop} onwards. Please invoice only up to ${lastDay}.`,
    '',
    pickupWhen
      ? `PICKUP: ready at our warehouse on ${pickupWhen}.`
      : 'PICKUP: ready at our warehouse.',
    "Please reply with the pickup person's name, phone number and vehicle number, or tell us the date, time and address if you want us to send them.",
    '',
    'Pickup address:',
    pickupAddress || '',
    '',
    `Laptops (request ${ticket.ticket_number}):`,
    ...items.map((r, i) => `${i + 1}. ${r.ttspl_id || '—'} | ${r.serial_number || '—'} | ${[r.brand, r.model].filter(Boolean).join(' ')} | ${r.configuration || ''} | ${r.po_number || ''}`),
    '',
    ticket.remarks ? `Note: ${ticket.remarks}` : '',
    'Details are in the attached PDF.',
    '',
    'Thanks and Regards,',
    SIGN_OFF,
  ].filter((l) => l !== null).join('\n');

  return { subject, html, text };
}

/** Sent when laptops come off a request the vendor was already told about. */
function buildCancelMail({ ticket, items, contactName, remainingCount = 0, reason }) {
  const n = items.length;
  const units = n === 1 ? 'laptop' : 'laptops';
  const greeting = contactName || ticket.vendor_name || 'Sir / Madam';
  const sent = prettyDate(ticket.vendor_notified_at || ticket.request_date);
  const subject = `Cancelled: return of ${n} ${units} — ${ticket.ticket_number} — ${SIGN_OFF}`;
  const rest = remainingCount > 0
    ? `The other ${remainingCount} laptop(s) on this request are still being returned as planned.`
    : '';
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">
  <p>Dear ${escapeHtml(greeting)},</p>
  <p>Please disregard our return request <strong>${escapeHtml(ticket.ticket_number)}</strong> of ${escapeHtml(sent)} for the ${n} ${units} listed below. We will continue to use ${n === 1 ? 'it' : 'them'}, and the <strong>rent continues as before</strong> — the rent stop in that mail no longer applies to ${n === 1 ? 'it' : 'them'}.</p>
  ${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}
  ${laptopTable(items)}
  ${rest ? `<p>${escapeHtml(rest)}</p>` : ''}
  <p>Sorry for any inconvenience.</p>
  <p>Thanks and Regards,<br/><strong>${escapeHtml(SIGN_OFF)}</strong></p>
</div>`;
  const text = [
    `Dear ${greeting},`,
    '',
    `Please disregard our return request ${ticket.ticket_number} of ${sent} for the ${n} ${units} below. We will continue to use them and the rent continues as before.`,
    reason ? `Reason: ${reason}` : '',
    ...items.map((r, i) => `${i + 1}. ${r.ttspl_id || '—'} | ${r.serial_number || '—'} | ${[r.brand, r.model].filter(Boolean).join(' ')}`),
    rest,
    '',
    'Thanks and Regards,',
    SIGN_OFF,
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}

module.exports = {
  REASONS,
  DEFAULT_CC,
  MAX_DAYS_AHEAD,
  SIGN_OFF,
  requestCc,
  todayIst,
  ymd,
  addDays,
  lastBilledDay,
  prettyDate,
  prettyTime,
  validateRequestDates,
  reasonLabel,
  buildRequestMail,
  buildCancelMail,
};
