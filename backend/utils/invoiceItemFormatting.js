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

function isSecurityLine(line) {
  return line?.line_type === 'security' || line?.is_security === true;
}

function isProRataLine(line) {
  if (isSecurityLine(line)) return false;
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
  const security = [];
  for (const line of lines) {
    if (isSecurityLine(line)) security.push(line);
    else if (isProRataLine(line)) catchup.push(line);
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
  return { catchup, full: [...fullHead, ...fullRest], security };
}

function lineYmd(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

function nextYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

/**
 * One printed row per laptop per unbroken span. The engine stores a line per
 * calendar month (returns and re-runs work month by month), so a quarterly
 * invoice holds Oct, Nov and Dec separately; the customer sees 1 Oct – 31 Dec.
 * Lines merge only when they are back to back at the same monthly rate.
 */
function mergeLaptopPeriodLines(lines) {
  const out = [];
  const lastByKey = new Map();
  const sorted = [...lines].sort((a, b) => lineYmd(a.rent_start).localeCompare(lineYmd(b.rent_start)));
  for (const line of sorted) {
    const key = lineAssetKey(line);
    const prev = key ? lastByKey.get(key) : null;
    const start = lineYmd(line.rent_start);
    if (
      prev
      && start
      && lineYmd(prev.rent_end)
      && nextYmd(lineYmd(prev.rent_end)) === start
      && Number(prev.monthly_rate) === Number(line.monthly_rate)
    ) {
      prev.rent_end = lineYmd(line.rent_end);
      prev.amount = +(Number(prev.amount || 0) + Number(line.amount || 0)).toFixed(2);
      prev.days_in_month = Number(prev.days_in_month || 0) + Number(line.days_in_month || 0);
      prev.month_days = Number(prev.month_days || 0) + Number(line.month_days || 0);
      continue;
    }
    const copy = { ...line, rent_start: start || line.rent_start, rent_end: lineYmd(line.rent_end) || line.rent_end };
    out.push(copy);
    if (key) lastByKey.set(key, copy);
  }
  // Keep the caller's laptop order.
  const order = new Map();
  lines.forEach((line, i) => {
    const key = lineAssetKey(line) || `#${i}`;
    if (!order.has(key)) order.set(key, i);
  });
  return out
    .map((line, i) => ({ line, i }))
    .sort((a, b) => {
      const oa = order.get(lineAssetKey(a.line)) ?? a.i;
      const ob = order.get(lineAssetKey(b.line)) ?? b.i;
      return oa - ob || lineYmd(a.line.rent_start).localeCompare(lineYmd(b.line.rent_start));
    })
    .map(({ line }) => line);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "July 2026", "October – December 2026", or "10 Jul – 30 Sep 2026". */
function linesSpanLabel(lines) {
  const starts = lines.map((l) => lineYmd(l.rent_start)).filter(Boolean).sort();
  const ends = lines.map((l) => lineYmd(l.rent_end)).filter(Boolean).sort();
  if (!starts.length || !ends.length) return '';
  const start = starts[0];
  const end = ends[ends.length - 1];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const wholeMonths = sd === 1 && nextYmd(end).endsWith('-01');
  if (!wholeMonths) return fmtPeriod(start, end);
  if (sy === ey && sm === em) return `${MONTH_NAMES[sm - 1]} ${sy}`;
  if (sy === ey) return `${MONTH_NAMES[sm - 1]} – ${MONTH_NAMES[em - 1]} ${sy}`;
  return `${MONTH_NAMES[sm - 1]} ${sy} – ${MONTH_NAMES[em - 1]} ${ey}`;
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

function countUniqueLaptops(lines = []) {
  const keys = new Set();
  let unnamed = 0;
  for (const line of lines) {
    const key = lineAssetKey(line);
    if (key) keys.add(key);
    else unnamed += 1;
  }
  return keys.size + unnamed;
}

module.exports = {
  fmtPeriod,
  parseItemDisplay,
  formatSpecLine,
  isProRataLine,
  isSecurityLine,
  lineAssetKey,
  countUniqueLaptops,
  groupLineItems,
  mergeLaptopPeriodLines,
  linesSpanLabel,
  fmtMoneyPlain,
  fmtMoneyInr,
  escapeHtml,
  gstStateCodeFromGstin,
  placeOfSupplyLabel,
  STATE_NAMES,
};
