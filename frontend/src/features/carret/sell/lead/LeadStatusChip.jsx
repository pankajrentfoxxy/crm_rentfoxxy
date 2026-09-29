import React from 'react';
import { STATUS_HINT, toneOf } from './leadShared';

/**
 * A lead's status as a coloured pill (its pipeline group's colour) with the
 * stage underneath when it says more. With onClick it is the button that
 * changes the status — from the list or the board, without opening the lead.
 */
export default function LeadStatusChip({ status, stage, onClick, compact = false }) {
  const tone = toneOf(status);
  const pill = (
    <span
      className="font-ui"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 999,
        background: tone.bg, color: tone.fg, fontWeight: 600, fontSize: 'var(--d-sm)', whiteSpace: 'nowrap',
        border: '1px solid transparent',
      }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: tone.fg }} />
      {status}
      {onClick && <span aria-hidden="true" style={{ opacity: 0.7 }}>▾</span>}
    </span>
  );
  const showStage = !compact && stage && stage !== status;
  const body = (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      {pill}
      {showStage && <span className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)', paddingLeft: 4 }}>{stage}</span>}
    </span>
  );
  if (!onClick) return <span title={STATUS_HINT[status]}>{body}</span>;
  return (
    <button
      type="button"
      title={`${STATUS_HINT[status] || status} — change status`}
      aria-label={`Status ${status}. Change status`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}
    >
      {body}
    </button>
  );
}
