import React from 'react';

/**
 * A laptop's lock-in (rented) or warranty (sold) in one line — shown wherever
 * Support picks a laptop (claude/carret-lockin-warranty.md). Needs the fields
 * GET /support/customers/:id/assets adds: deal, lock_in_*, warranty_*.
 */
export const fmtDay = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const WARN = { color: 'var(--alert-warn)', fontWeight: 600 };
const CRIT = { color: 'var(--alert-crit)', fontWeight: 600 };
const OK = { color: 'var(--ok, #15803d)' };

export function termsText(a) {
  if (!a) return null;
  if (a.deal === 'rental') {
    if (a.lock_in_active) return { style: WARN, text: `Lock-in till ${fmtDay(a.lock_in_end_date)} · ${a.lock_in_days_left} days left` };
    if (a.lock_in_end_date) return { style: OK, text: `Lock-in over (${fmtDay(a.lock_in_end_date)})` };
    return null;
  }
  if (a.deal === 'sale') {
    if (a.warranty_status === 'in') return { style: OK, text: `Sold · warranty till ${fmtDay(a.warranty_end_date)}` };
    if (a.warranty_status === 'battery_only') return { style: WARN, text: `Sold · only battery / charger warranty (till ${fmtDay(a.battery_warranty_end_date)})` };
    return { style: CRIT, text: `Sold · out of warranty${a.warranty_end_date ? ` (ended ${fmtDay(a.warranty_end_date)})` : ''} — chargeable` };
  }
  return null;
}

export default function TermsBadge({ laptop }) {
  const t = termsText(laptop);
  if (!t) return null;
  return (
    <span style={t.style}>
      {t.text}
      {laptop.early_return && (
        <span className="text-ink-3" style={{ fontWeight: 400 }}> · early return {String(laptop.early_return.status).replace(/_/g, ' ')}</span>
      )}
    </span>
  );
}
