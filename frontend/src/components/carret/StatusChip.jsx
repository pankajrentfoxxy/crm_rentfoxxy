import React from 'react';
import { statusFamily, statusLabel, statusGlyph, isCanonicalAssetStatus } from '../../config/statuses';

/**
 * A status never travels as colour alone.
 *
 * The dark-mode family pairs sit in the 6-8 CVD floor band, which is only a
 * legal encoding when something else carries the same information. That is why
 * the glyph and the word are both mandatory and neither is a prop.
 *
 * An unrecognised status renders neutral with its raw string and warns in
 * development — it has to be visible. Silently swallowing it is how twenty
 * statuses accumulated in the first place.
 */
/**
 * Document statuses — quotations, orders, challans, invoices, POs. These are
 * not asset lifecycle states and never will be, so they get their own small
 * map instead of rendering as a stray "?". Same rule as assets: a tone AND a
 * glyph AND a word. Anything in neither list still renders as a visible stray.
 */
const DOC_STATUS = {
  draft:      { tone: 'closed',  glyph: '○' },
  pending:    { tone: 'moving',  glyph: '○' },
  sent:       { tone: 'idle',    glyph: '➔' },
  issued:     { tone: 'idle',    glyph: '➔' },
  confirmed:  { tone: 'earning', glyph: '●' },
  accepted:   { tone: 'earning', glyph: '●' },
  approved:   { tone: 'earning', glyph: '●' },
  active:     { tone: 'earning', glyph: '●' },
  partial:    { tone: 'moving',  glyph: '◐' },
  dispatched: { tone: 'idle',    glyph: '➔' },
  delivered:  { tone: 'earning', glyph: '✓' },
  received:   { tone: 'earning', glyph: '✓' },
  completed:  { tone: 'earning', glyph: '✓' },
  paid:       { tone: 'earning', glyph: '✓' },
  closed:     { tone: 'closed',  glyph: '✓' },
  overdue:    { tone: 'crit',    glyph: '!' },
  rejected:   { tone: 'crit',    glyph: '✕' },
  cancelled:  { tone: 'closed',  glyph: '⊘' },
  suspended:  { tone: 'crit',    glyph: '⊘' },
  pending_approval: { tone: 'moving',  glyph: '○' },
  vendor_accepted:  { tone: 'earning', glyph: '●' },
  vendor_rejected:  { tone: 'crit',    glyph: '✕' },
  processing:       { tone: 'moving',  glyph: '◐' },
};

const TONE_VARS = {
  crit: { fg: 'var(--alert-crit)', bg: 'var(--alert-crit-soft)' },
};

export default function StatusChip({ status, className = '', title, label }) {
  const known = isCanonicalAssetStatus(status);
  const doc = known ? null : DOC_STATUS[String(status || '').toLowerCase()];
  const family = doc ? doc.tone : statusFamily(status);

  const style = TONE_VARS[family]
    ? { background: TONE_VARS[family].bg, color: TONE_VARS[family].fg }
    : { background: `var(--lc-${family}-soft)`, color: `var(--lc-${family})` };

  return (
    <span
      className={`c-chip font-ui ${className}`}
      style={style}
      title={title || (known || doc ? undefined : `Non-canonical status: ${status}`)}
      data-status={status || ''}
      data-family={family}
    >
      <span aria-hidden="true">{doc ? doc.glyph : statusGlyph(status)}</span>
      <span>{label || (doc ? String(status).charAt(0).toUpperCase() + String(status).slice(1).toLowerCase().replace(/_/g, ' ') : statusLabel(status))}</span>
    </span>
  );
}
