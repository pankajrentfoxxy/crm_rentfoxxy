import React from 'react';

/**
 * The one place a date becomes text. DD MMM YY by default; a raw ISO string
 * never reaches the screen.
 */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function formatDate(value, format = 'date') {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mmm = MONTHS[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  if (format === 'datetime') {
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd} ${mmm} ${yy}, ${hh}:${mi}`;
  }
  if (format === 'long') return `${dd} ${mmm} ${d.getFullYear()}`;
  return `${dd} ${mmm} ${yy}`;
}

export default function DateTime({ value, format = 'date', className = '' }) {
  const text = formatDate(value, format);
  const iso = value ? new Date(value).toISOString?.() : undefined;
  return (
    <time className={`tabular-nums whitespace-nowrap ${className}`} dateTime={iso}>{text}</time>
  );
}
