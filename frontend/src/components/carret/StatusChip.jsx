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
export default function StatusChip({ status, className = '', title }) {
  const family = statusFamily(status);
  const known = isCanonicalAssetStatus(status);

  const style = {
    background: `var(--lc-${family}-soft)`,
    color: `var(--lc-${family})`,
    borderColor: `var(--lc-${family})`,
    fontSize: 'var(--d-sm)',
    padding: 'calc(var(--d-pad-y) / 2) var(--d-pad-x)',
    borderRadius: 'var(--d-radius)',
    minHeight: 'var(--d-tap)',
  };

  return (
    <span
      className={`inline-flex items-center gap-d border font-ui leading-none whitespace-nowrap ${className}`}
      style={style}
      title={title || (known ? undefined : `Non-canonical status: ${status}`)}
      data-status={status || ''}
      data-family={family}
    >
      <span aria-hidden="true">{statusGlyph(status)}</span>
      <span>{statusLabel(status)}</span>
    </span>
  );
}
