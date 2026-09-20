import React from 'react';

/**
 * Used zero times in the legacy app. It belongs everywhere a list can be empty:
 * one line and one action, never a paragraph explaining the architecture behind
 * the emptiness.
 */
export default function EmptyState({ title = 'Nothing here yet', body, action, className = '' }) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${className}`}
      style={{ padding: 'calc(var(--d-pad-y) * 6) var(--d-pad-x)', gap: 'var(--d-gap)' }}
    >
      <div className="font-ui text-ink" style={{ fontSize: 'var(--d-lg)', fontWeight: 600 }}>{title}</div>
      {body && <div className="font-ui text-ink-2" style={{ fontSize: 'var(--d-base)', maxWidth: '52ch' }}>{body}</div>}
      {action && <div style={{ marginTop: 'var(--d-gap)' }}>{action}</div>}
    </div>
  );
}
