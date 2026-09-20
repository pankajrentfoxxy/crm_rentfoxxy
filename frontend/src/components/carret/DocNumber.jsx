import React, { useState, useCallback } from 'react';

/** Monospace, never wraps mid-number, click to copy. */
export default function DocNumber({ value, className = '' }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    if (!value) return;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(String(value)).then(done).catch(() => {});
      else done();
    } catch { /* clipboard is a convenience, never a failure path */ }
  }, [value]);

  if (!value) return <span className="font-mono text-ink-3">—</span>;

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied' : 'Click to copy'}
      className={`font-mono whitespace-nowrap text-ink hover:text-accent bg-transparent border-0 p-0 cursor-pointer ${className}`}
      style={{ fontSize: 'inherit' }}
    >
      {value}{copied ? ' ✓' : ''}
    </button>
  );
}
