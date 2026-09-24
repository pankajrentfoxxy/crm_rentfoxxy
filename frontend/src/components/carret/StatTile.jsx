import React from 'react';

/**
 * `family` tints the value, never the whole tile — a tile that turns green is
 * decoration; a number that does is information.
 *
 * No tile without a real figure behind it. Pass `value={null}` and it says so
 * rather than rendering a confident zero, because a dashboard that is
 * confidently wrong is worse than no dashboard and this system has had one.
 */
export default function StatTile({ label, value, delta, family, unit, className = '' }) {
  const hasValue = value !== null && value !== undefined && value !== '';
  return (
    <div
      className={`c-card ${className}`}
      style={{ padding: '14px 16px' }}
    >
      <div className="text-ink-3 font-ui" style={{ fontSize: '13px', fontWeight: 500 }}>{label}</div>
      <div
        className="font-ui tabular-nums"
        style={{
          fontSize: '26px',
          fontWeight: 600,
          letterSpacing: '-.01em',
          lineHeight: 1.2,
          marginTop: '4px',
          color: family ? `var(--lc-${family})` : 'var(--ink)',
        }}
      >
        {hasValue ? value : '—'}{hasValue && unit ? <span className="text-ink-3" style={{ fontSize: 'var(--d-base)' }}> {unit}</span> : null}
      </div>
      {delta != null && (
        <div className="font-mono text-ink-3" style={{ fontSize: 'var(--d-sm)', marginTop: 'var(--d-gap)' }}>{delta}</div>
      )}
      {!hasValue && (
        <div className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>no data source yet</div>
      )}
    </div>
  );
}
