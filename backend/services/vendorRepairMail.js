/**
 * Vendor repair challan (claude/carret-vendor-repair.md) — issue types, the
 * declared-value rule, and the words of every mail. No database access, so it
 * can be tested on its own. Dates are IST 'YYYY-MM-DD' strings (see
 * vendorReturnRequestMail for the date helpers shared with the return request).
 */
const { escapeHtml } = require('../utils/escapeHtml');
const { prettyDate, SIGN_OFF } = require('./vendorReturnRequestMail');

const ISSUE_TYPES = {
  no_power: 'Not powering on / dead',
  motherboard: 'Motherboard / chip-level fault',
  display: 'Display / screen',
  keyboard: 'Keyboard',
  touchpad: 'Touchpad',
  battery: 'Battery',
  charging: 'Charging port / adapter',
  storage: 'Storage (SSD / HDD)',
  ram: 'RAM / memory',
  overheating: 'Overheating / fan',
  hinge_body: 'Hinge / body damage',
  ports: 'Ports (USB / HDMI / LAN)',
  audio_camera: 'Audio / camera / mic',
  wifi: 'Wi-Fi / Bluetooth',
  bios_os: 'BIOS / OS / software lock',
  other: 'Other',
};

function issueLabel(code) {
  return ISSUE_TYPES[code] || null;
}

const RENTAL_TYPES = ['rental_purchase', 'rent_to_own'];

/**
 * The value a laptop is declared at on a challan: the PO line's asset value;
 * on a rental line with none, the line's Rate when it is clearly a purchase
 * price (differs from, and is above, the monthly rent); on a purchase PO, the
 * line's Rate. Null when nothing usable exists — the warehouse enters it.
 */
function declaredValueFromLine(poType, line) {
  if (!line || typeof line !== 'object') return null;
  const num = (v) => {
    const n = Number(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const asset = num(line.asset_value);
  if (asset) return asset;
  const rate = num(line.rate);
  if (RENTAL_TYPES.includes(String(poType || '').toLowerCase())) {
    const monthly = num(line.monthly_rental_amount) || num(line.monthly_rate);
    if (rate && monthly && rate > monthly) return rate;
    return null;
  }
  return rate;
}

const cell = 'padding:6px 8px;border:1px solid #d9dee5;font-size:13px;vertical-align:top';

function repairTable(items) {
  const rows = items.map((r, i) => `
    <tr>
      <td style="${cell};text-align:right">${i + 1}</td>
      <td style="${cell};font-family:monospace">${escapeHtml(r.ttspl_id || '—')}</td>
      <td style="${cell};font-family:monospace">${escapeHtml(r.serial_number || '—')}</td>
      <td style="${cell}">${escapeHtml(r.configuration || '—')}</td>
      <td style="${cell}">${escapeHtml(issueLabel(r.issue_type) || '—')}</td>
      <td style="${cell}">${escapeHtml(r.item_remarks || '—')}</td>
    </tr>`).join('');
  return `
    <table style="border-collapse:collapse;margin:8px 0 16px">
      <thead><tr style="background:#0e7490;color:#fff">
        <th style="${cell};text-align:right">#</th>
        <th style="${cell};text-align:left">TTSPL ID</th>
        <th style="${cell};text-align:left">Serial no.</th>
        <th style="${cell};text-align:left">Configuration</th>
        <th style="${cell};text-align:left">Issue</th>
        <th style="${cell};text-align:left">Remarks</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const wrap = (body) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">${body}
  <p>Thanks and Regards,<br/><strong>${escapeHtml(SIGN_OFF)}</strong></p></div>`;

const sign = ['', 'Thanks and Regards,', SIGN_OFF];

function units(n) { return n === 1 ? 'laptop' : 'laptops'; }

/** "We are sending these for repair; rent stops from X until they are back." */
function buildRepairRequestMail({ dc, items, stopDate, contactName, pausedCount }) {
  const n = items.length;
  const greet = contactName || dc.vendor_name || 'Sir / Madam';
  const stop = prettyDate(stopDate);
  const subject = `Repair of ${n} ${units(n)} — ${dc.dc_number} — ${SIGN_OFF}`;
  const rentPara = pausedCount > 0
    ? `<p style="padding:10px 12px;background:#fff7ed;border-left:4px solid #ea580c"><strong>Rent:</strong> we are stopping the rent on ${pausedCount === n ? (n === 1 ? 'this laptop' : 'these laptops') : `${pausedCount} of these laptops (rented from you)`} from <strong>${escapeHtml(stop)}</strong> while ${n === 1 ? 'it is' : 'they are'} with you for repair. Rent starts again from the day ${n === 1 ? 'it reaches' : 'each reaches'} our warehouse gate. If a laptop can't be repaired and you send a replacement, rent on the replacement starts from the day it reaches us.</p>`
    : '';
  const html = wrap(`
  <p>Dear ${escapeHtml(greet)},</p>
  <p>Greetings from ${escapeHtml(SIGN_OFF)}.</p>
  <p>We are sending the ${n} ${units(n)} below to you for repair on challan <strong>${escapeHtml(dc.dc_number)}</strong>. The issue found on each is listed.</p>
  ${rentPara}
  ${repairTable(items)}
  ${dc.expected_return_date ? `<p>Please return ${n === 1 ? 'it' : 'them'} by <strong>${escapeHtml(prettyDate(dc.expected_return_date))}</strong>.</p>` : ''}
  <p>If a laptop can't be repaired, please tell us before sending a replacement — a replacement of a different model or configuration needs our approval.</p>
  <p>The same details are in the attached PDF.</p>`);
  const text = [
    `Dear ${greet},`, '',
    `We are sending the ${n} ${units(n)} below for repair on challan ${dc.dc_number}.`,
    pausedCount > 0 ? `RENT: stopped from ${stop} while with you for repair; it starts again from the day each laptop reaches our gate.` : '',
    '',
    ...items.map((r, i) => `${i + 1}. ${r.ttspl_id || '—'} | ${r.serial_number || '—'} | ${r.configuration || ''} | ${issueLabel(r.issue_type) || ''} | ${r.item_remarks || ''}`),
    dc.expected_return_date ? `\nPlease return by ${prettyDate(dc.expected_return_date)}.` : '',
    'A replacement of a different model or configuration needs our approval.',
    ...sign,
  ].filter((l) => l !== '').join('\n');
  return { subject, html, text };
}

function buildRepairCancelMail({ dc, items, contactName, reason }) {
  const n = items.length;
  const greet = contactName || dc.vendor_name || 'Sir / Madam';
  const subject = `Cancelled: repair of ${n} ${units(n)} — ${dc.dc_number} — ${SIGN_OFF}`;
  const html = wrap(`
  <p>Dear ${escapeHtml(greet)},</p>
  <p>Please disregard our repair challan <strong>${escapeHtml(dc.dc_number)}</strong>. The ${n} ${units(n)} below are not being sent, and the <strong>rent continues as before</strong> — the rent stop in our earlier mail does not apply.</p>
  ${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}
  ${repairTable(items)}`);
  const text = [`Dear ${greet},`, '', `Please disregard repair challan ${dc.dc_number}; the laptops are not being sent and rent continues as before.`, reason ? `Reason: ${reason}` : '', ...sign].filter(Boolean).join('\n');
  return { subject, html, text };
}

/** The vendor could not repair it and keeps it: our confirmation. */
function buildVendorKeptMail({ dc, item, contactName, reason, rentEndDate }) {
  const greet = contactName || dc.vendor_name || 'Sir / Madam';
  const subject = `Confirmation: ${item.ttspl_id || item.serial_number} returned to you (not repairable) — ${dc.dc_number}`;
  const html = wrap(`
  <p>Dear ${escapeHtml(greet)},</p>
  <p>As discussed, the laptop below, sent to you for repair on <strong>${escapeHtml(dc.dc_number)}</strong>, could not be repaired and stays with you. We are recording it as <strong>returned to you</strong>.</p>
  ${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}
  ${repairTable([item])}
  <p><strong>Rent:</strong> no rent is due for it after <strong>${escapeHtml(prettyDate(rentEndDate))}</strong>. Please remove it from your rental invoices from then on.</p>`);
  const text = [`Dear ${greet},`, '', `${item.ttspl_id || ''} (${item.serial_number || ''}) sent on ${dc.dc_number} could not be repaired and stays with you; we record it as returned to you.`, reason ? `Reason: ${reason}` : '', `No rent is due for it after ${prettyDate(rentEndDate)}.`, ...sign].filter(Boolean).join('\n');
  return { subject, html, text };
}

/** A replacement of a different model/config was not approved. */
function buildReplacementRejectedMail({ dc, item, proposed, contactName, note }) {
  const greet = contactName || dc.vendor_name || 'Sir / Madam';
  const what = [proposed?.brand, proposed?.model].filter(Boolean).join(' ') || 'the laptop';
  const subject = `Replacement not accepted — ${item.ttspl_id || item.serial_number} — ${dc.dc_number}`;
  const html = wrap(`
  <p>Dear ${escapeHtml(greet)},</p>
  <p>The replacement you sent for <strong>${escapeHtml(item.ttspl_id || '')}</strong> (serial ${escapeHtml(item.serial_number || '')}, ${escapeHtml(item.configuration || '')}) on <strong>${escapeHtml(dc.dc_number)}</strong> — ${escapeHtml(what)}${proposed?.serial_number ? `, serial ${escapeHtml(proposed.serial_number)}` : ''} — does not match the model / configuration we sent and <strong>has not been accepted</strong>. We are handing it back to you.</p>
  ${note ? `<p>Note: ${escapeHtml(note)}</p>` : ''}
  <p>Please repair the original, or send a replacement of the same model and configuration. The rent on it stays stopped until a laptop we accept reaches our gate.</p>`);
  const text = [`Dear ${greet},`, '', `The replacement for ${item.ttspl_id || ''} on ${dc.dc_number} (${what}${proposed?.serial_number ? `, serial ${proposed.serial_number}` : ''}) does not match and has not been accepted; we are handing it back.`, note ? `Note: ${note}` : '', 'Please repair the original or send the same model and configuration.', ...sign].filter(Boolean).join('\n');
  return { subject, html, text };
}

/** To Accounts / the approver: a replacement needs a decision. */
function buildApprovalRequestMail({ dc, item, proposed, checks = [], link }) {
  const subject = `Approve replacement? ${item.ttspl_id || item.serial_number} — ${dc.dc_number} — ${dc.vendor_name || ''}`;
  const sent = item.configuration || '—';
  const got = [proposed?.brand, proposed?.model, proposed?.processor, proposed?.generation, proposed?.ram, proposed?.ssd || proposed?.storage].filter(Boolean).join(' · ') || '—';
  const mism = checks.filter((c) => c && c.matched === false).map((c) => `${c.label || c.field}: expected ${c.expected ?? '—'}, found ${c.actual ?? '—'}`);
  const html = wrap(`
  <p>The vendor <strong>${escapeHtml(dc.vendor_name || '')}</strong> sent a replacement for <strong>${escapeHtml(item.ttspl_id || '')}</strong> on ${escapeHtml(dc.dc_number)} that does not match what we sent. It needs your approval before it is taken into stock.</p>
  <table style="border-collapse:collapse;font-size:13px">
    <tr><td style="padding:4px 10px 4px 0;color:#64748b">We sent</td><td>${escapeHtml(sent)} · serial ${escapeHtml(item.serial_number || '—')}</td></tr>
    <tr><td style="padding:4px 10px 4px 0;color:#64748b">They sent</td><td>${escapeHtml(got)}${proposed?.serial_number ? ` · serial ${escapeHtml(proposed.serial_number)}` : ''}</td></tr>
    ${proposed?.condition === 'not_on' ? '<tr><td style="padding:4px 10px 4px 0;color:#64748b">Note</td><td>It does not power on, so its configuration could not be read.</td></tr>' : ''}
  </table>
  ${mism.length ? `<p style="margin-bottom:4px"><strong>Differences</strong></p><ul>${mism.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : ''}
  <p>If approved, it becomes the replacement at the original laptop's monthly rent, billed from the day it reached the gate. If rejected, the vendor is told and it is handed back.</p>
  ${link ? `<p><a href="${escapeHtml(link)}">Approve or reject in the CRM</a></p>` : ''}`);
  const text = [`Replacement for ${item.ttspl_id || ''} on ${dc.dc_number} (${dc.vendor_name || ''}) needs approval.`, `We sent: ${sent}`, `They sent: ${got}${proposed?.serial_number ? ` (serial ${proposed.serial_number})` : ''}`, ...mism, link || ''].filter(Boolean).join('\n');
  return { subject, html, text };
}

/** What the script read off the replacement, from its check rows. */
function proposedFromChecks(checks = [], serialNumber = null) {
  const by = Object.fromEntries((checks || []).filter(Boolean).map((c) => [c.field, c.actual]));
  return {
    brand: by.brand || null,
    model: by.model || null,
    processor: by.processor || null,
    generation: by.generation || null,
    ram: by.ram || null,
    ssd: by.ssd || by.storage || null,
    serial_number: serialNumber || null,
  };
}

module.exports = {
  proposedFromChecks,
  ISSUE_TYPES,
  issueLabel,
  declaredValueFromLine,
  buildRepairRequestMail,
  buildRepairCancelMail,
  buildVendorKeptMail,
  buildReplacementRejectedMail,
  buildApprovalRequestMail,
};
