'use strict';

/** Indian Standard Time — used for all CRM-generated PDF timestamps. */
const PDF_TZ = 'Asia/Kolkata';
const PDF_TZ_LABEL = 'IST';

const DATE_FMT = {
  timeZone: PDF_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
};

const DATETIME_FMT = {
  timeZone: PDF_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
};

function parsePdfDateInput(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const s = String(value).trim();
  if (!s) return null;

  // Calendar date (no time) — anchor at noon IST to avoid day-shift when formatting.
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoDate) {
    const [, y, m, d] = isoDate;
    return new Date(`${y}-${m}-${d}T12:00:00+05:30`);
  }

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    return new Date(`${y}-${m}-${d}T12:00:00+05:30`);
  }

  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatPdfDateIst(value, { fallback = null, withLabel = true } = {}) {
  const dt = parsePdfDateInput(value);
  if (!dt) return fallback;
  const formatted = dt.toLocaleDateString('en-IN', DATE_FMT);
  return withLabel ? `${formatted} (${PDF_TZ_LABEL})` : formatted;
}

function formatPdfDateTimeIst(value, { fallback = null, withLabel = true } = {}) {
  const dt = parsePdfDateInput(value);
  if (!dt) return fallback;
  const formatted = dt.toLocaleString('en-IN', DATETIME_FMT);
  return withLabel ? `${formatted} (${PDF_TZ_LABEL})` : formatted;
}

function formatPdfDateIstOrDash(value) {
  return formatPdfDateIst(value, { fallback: '—' });
}

function formatPdfDateTimeIstOrDash(value) {
  return formatPdfDateTimeIst(value, { fallback: '—' });
}

function formatPdfNowIst() {
  return formatPdfDateTimeIst(new Date());
}

function formatPdfDateLabel(prefix, value) {
  const formatted = formatPdfDateIst(value, { fallback: null });
  if (!formatted) return null;
  return prefix ? `${prefix}${formatted}` : formatted;
}

function formatPdfDateTimeLabel(prefix, value) {
  const formatted = formatPdfDateTimeIst(value, { fallback: null });
  if (!formatted) return null;
  return prefix ? `${prefix}${formatted}` : formatted;
}

module.exports = {
  PDF_TZ,
  PDF_TZ_LABEL,
  parsePdfDateInput,
  formatPdfDateIst,
  formatPdfDateTimeIst,
  formatPdfDateIstOrDash,
  formatPdfDateTimeIstOrDash,
  formatPdfNowIst,
  formatPdfDateLabel,
  formatPdfDateTimeLabel,
};
