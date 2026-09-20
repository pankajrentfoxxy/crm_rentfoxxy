import React from 'react';

/**
 * Indian digit grouping (1,23,456), tabular numerals, and a minus sign rather
 * than parentheses for a negative — parentheses are an accounting convention
 * that reads as a typo to everyone else, and they are invisible at small sizes.
 */
const FORMATTER = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function Money({ value, currency = 'INR', className = '', showZero = true }) {
  const n = Number(value);
  if (!Number.isFinite(n) || (!showZero && n === 0)) {
    return <span className={`font-mono text-ink-3 ${className}`}>—</span>;
  }
  const negative = n < 0;
  const symbol = currency === 'INR' ? '₹' : '';
  return (
    <span
      className={`font-mono tabular-nums whitespace-nowrap ${className}`}
      style={negative ? { color: 'var(--alert-crit)' } : undefined}
    >
      {negative ? '-' : ''}{symbol}{FORMATTER.format(Math.abs(n))}
    </span>
  );
}
