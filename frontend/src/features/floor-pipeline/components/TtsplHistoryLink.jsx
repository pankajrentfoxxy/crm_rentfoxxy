import React from 'react';

/**
 * Clickable TTSPL / serial that opens TtsplHistoryDrawer.
 * History API is TTSPL-keyed — pass ttsplId even when displaying a serial.
 */
export default function TtsplHistoryLink({
  ttsplId,
  label,
  className = 'font-mono text-xs font-semibold text-blue-700 hover:underline text-left',
  onOpen,
  stopPropagation = true,
}) {
  const text = label || ttsplId || '—';
  const id = ttsplId || null;
  if (!id || !onOpen) {
    return <span className={className.replace('text-blue-700 hover:underline', 'text-slate-700')}>{text}</span>;
  }
  return (
    <button
      type="button"
      title="View history"
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onOpen(id);
      }}
      className={className}
    >
      {text}
    </button>
  );
}
