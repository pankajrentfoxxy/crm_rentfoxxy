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
      className={`bg-surface border border-rule ${className}`}
      style={{ padding: 'var(--d-pad-x)', borderRadius: 'var(--d-radius)' }}
    >
      <div className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>{label}</div>
      <div
        className="font-mono tabular-nums"
        style={{
          fontSize: 'calc(var(--d-lg) * 1.6)',
          lineHeight: 1.1,
          marginTop: 'var(--d-gap)',
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
