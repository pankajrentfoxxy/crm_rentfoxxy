import React from 'react';
import { StatusChip } from '../../../components/carret';

/**
 * Money statuses on the shared chip. The chip knows document statuses; these
 * money-only words are mapped onto a known tone with their own label, so none
 * renders as an unrecognised stray.
 */
const MONEY_STATUS = {
  partially_paid: { status: 'partial', label: 'Part paid' },
  applied: { status: 'completed', label: 'Applied' },
  held: { status: 'active', label: 'Held' },
  refunded: { status: 'closed', label: 'Refunded' },
  partially_refunded: { status: 'partial', label: 'Part refunded' },
  adjusted: { status: 'closed', label: 'Adjusted' },
  pending: { status: 'pending', label: 'Awaiting approval' },
};

export function MoneyChip({ status }) {
  const key = String(status || '').toLowerCase();
  const m = MONEY_STATUS[key];
  if (m) return <StatusChip status={m.status} label={m.label} />;
  return <StatusChip status={key || 'draft'} />;
}

export const outstandingOf = (inv) => Math.max(0, Math.round((Number(inv?.grand_total || 0) - Number(inv?.amount_paid || 0)) * 100) / 100);

export const periodLabel = (month, year, MONTHS) => (month && year ? `${MONTHS[Number(month)] || month} ${year}` : '—');

/** Grid of stat tiles. */
export function Tiles({ children }) {
  return (
    <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {children}
    </div>
  );
}

/** Previous / next pager under a list. */
export function Pager({ page, totalPages, onPage }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end font-ui text-ink-2" style={{ gap: '8px', padding: '10px 12px', fontSize: 'var(--d-sm)' }}>
      <button type="button" className="c-btn c-btn--quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" className="c-btn c-btn--quiet" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
