import React from 'react';

/**
 * Used zero times in the legacy app. It belongs everywhere a list can be empty:
 * one line and one action, never a paragraph explaining the architecture behind
 * the emptiness.
 */
export default function EmptyState({ title = 'Nothing here yet', body, action, className = '' }) {
  return (
    <div className={`c-empty ${className}`}>
      <div className="font-ui text-ink" style={{ fontSize: '16px', fontWeight: 600 }}>{title}</div>
      {body && <div className="font-ui text-ink-3" style={{ fontSize: 'var(--d-base)', maxWidth: '56ch' }}>{body}</div>}
      {action && <div style={{ marginTop: '8px' }}>{action}</div>}
    </div>
  );
}
