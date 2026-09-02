'use strict';

const { parsePdfDateInput } = require('./pdfDateTimeUtils');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtShortDate(d) {
  const dt = parsePdfDateInput(d);
  if (!dt) return null;
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(dt);
  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const year = parts.find((p) => p.type === 'year')?.value;
  return { day, month, year };
}

/** "06 Aug – 31 Aug 2026" — no IST suffix in table cells. */
function fmtPeriod(start, end) {
  const s = fmtShortDate(start);
  const e = fmtShortDate(end);
  if (!s || !e) return '—';
  if (s.year === e.year) return `${s.day} ${s.month} – ${e.day} ${e.month} ${e.year}`;
  return `${s.day} ${s.month} ${s.year} – ${e.day} ${e.month} ${e.year}`;
}

function normalizeThinkPad(text) {
  return String(text || '')
    .replace(/\bThinkpad\b/gi, 'ThinkPad')
    .replace(/\bX-(\d+)\b/gi, 'X$1');
}

function parseItemDisplay(brand, model) {
  let m = String(model || '').trim();
  const b = String(brand || '').trim();
  let note = null;

  const touch = m.match(/\(([^)]*touch[^)]*)\)/i);
  if (touch) {
    note = touch[1].trim();
    m = m.replace(/\([^)]*touch[^)]*\)/i, '').trim();
  }

  if (b && m && !m.toLowerCase().startsWith(b.toLowerCase())) {
    m = `${b} ${m}`.trim();
  } else if (b && !m) {
    m = b;
  }

  m = normalizeThinkPad(m);
  if (note) note = note.replace(/^\(|\)$/g, '').trim();

  return { title: m || '—', note };
}

function tidySpecPart(value) {
  const v = String(value || '').replace(/\s+/g, ' ').trim();
  if (!v || v === '-' || v === '—') return '';
  return v;
}

function tidyRam(value) {
  const v = tidySpecPart(value);
  if (!v) return '';
  if (/^\d+(\.\d+)?$/.test(v)) return `${v}GB`;
  return v;
}

/** Compact second line: I5 · 11TH · 16GB · 512 SSD */
function formatSpecLine(line = {}) {
  const parts = [
    tidySpecPart(line.processor),
    tidySpecPart(line.generation),
    tidyRam(line.ram),
    tidySpecPart(line.storage || line.hard_disk || line.hdd),
  ].filter(Boolean);
  return parts.join(' · ');
}

function isProRataLine(line) {
  if (line.is_catchup) return true;
  const billed = Number(line.days_in_month || 0);
  const monthDays = Number(line.month_days || 0);
  return monthDays > 0 && billed < monthDays;
}

function lineAssetKey(line) {
  if (line?.serial_id != null && line.serial_id !== '') return `id:${line.serial_id}`;
  if (line?.ttspl_id) return `t:${String(line.ttspl_id).trim()}`;
  if (line?.serial_number) return `s:${String(line.serial_number).trim()}`;
  return null;
}

function groupLineItems(lines) {
  const catchup = [];
  const full = [];
  for (const line of lines) {
    if (isProRataLine(line)) catchup.push(line);
    else full.push(line);
  }
  // September (billing-month) lines for catch-up units go first so the
  // customer sees August catch-up and the same units' next-month rent together.
  const catchupKeys = new Set(catchup.map(lineAssetKey).filter(Boolean));
  const fullHead = [];
  const fullRest = [];
  for (const line of full) {
    const key = lineAssetKey(line);
    if (key && catchupKeys.has(key)) fullHead.push(line);
    else fullRest.push(line);
  }
  return { catchup, full: [...fullHead, ...fullRest] };
}

function fmtMoneyPlain(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoneyInr(n) {
  return `₹ ${fmtMoneyPlain(n)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATE_NAMES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '32': 'Kerala', '33': 'Tamil Nadu',
  '36': 'Telangana', '37': 'Andhra Pradesh',
};

function gstStateCodeFromGstin(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  if (g.length >= 2 && /^\d{2}/.test(g)) return g.slice(0, 2);
  return '';
}

function placeOfSupplyLabel(gstin, fallbackState) {
  const code = gstStateCodeFromGstin(gstin);
  if (code && STATE_NAMES[code]) return `${STATE_NAMES[code]} (${code})`;
  if (fallbackState) return String(fallbackState);
  return code ? `State (${code})` : '—';
}

module.exports = {
  fmtPeriod,
  parseItemDisplay,
  formatSpecLine,
  isProRataLine,
  groupLineItems,
  fmtMoneyPlain,
  fmtMoneyInr,
  escapeHtml,
  gstStateCodeFromGstin,
  placeOfSupplyLabel,
  STATE_NAMES,
};
