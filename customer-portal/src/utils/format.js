import { format, parseISO } from 'date-fns';

export function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function toDate(value) {
  if (!value) return null;
  const d = typeof value === 'string' ? parseISO(value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value, fallback = '—') {
  const d = toDate(value);
  return d ? format(d, 'dd MMM yyyy') : fallback;
}

export function fmtDateTime(value, fallback = '—') {
  const d = toDate(value);
  return d ? format(d, 'dd MMM yyyy, h:mm a') : fallback;
}

/** `in_transit` -> `In Transit` */
export function humanize(value, fallback = '—') {
  if (value == null || value === '') return fallback;
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Today's date as `yyyy-MM-dd`, for date inputs. */
export function today() {
  return format(new Date(), 'yyyy-MM-dd');
}
