import React, { useEffect, useState } from 'react';
import { BellOff, Clock } from 'lucide-react';
import { getCountdownState, isSnoozeActive } from '../../dispatch/dispatchAlertUtils';

const TONE_CLASS = {
  normal: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  urgent: 'text-amber-700 bg-amber-50 border-amber-200',
  muted: 'text-red-800 bg-red-100 border-red-300 font-semibold',
  snoozed: 'text-sky-800 bg-sky-100 border-sky-300 font-semibold',
};

/** Live Dispatch QC SLA + snooze countdown on floor ticket detail. */
export default function DispatchQcEtaBadge({ dispatchQcEta, snoozedUntil }) {
  const [, tick] = useState(0);
  const effectiveSnoozeUntil = snoozedUntil ?? dispatchQcEta?.qc_alert_snoozed_until;
  const snoozeActive = isSnoozeActive(effectiveSnoozeUntil);

  useEffect(() => {
    if (!dispatchQcEta?.qc_due_at && !effectiveSnoozeUntil) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [dispatchQcEta?.qc_due_at, effectiveSnoozeUntil]);

  if (!dispatchQcEta?.qc_due_at) return null;

  if (snoozeActive) {
    const snoozeCountdown = getCountdownState(effectiveSnoozeUntil);
    const remark = dispatchQcEta.qc_alert_snooze_remark;
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs tabular-nums ${TONE_CLASS.snoozed}`}
        title={remark ? `Snooze reason: ${remark}` : 'QC reminder snoozed'}
      >
        <BellOff className="w-3.5 h-3.5 shrink-0" />
        Snoozed — {snoozeCountdown.label} left
      </span>
    );
  }

  const countdown = getCountdownState(dispatchQcEta.qc_due_at);
  const overdue = dispatchQcEta.qc_overdue || !countdown.active;
  const tone = overdue ? 'muted' : countdown.tone;
  const label = overdue
    ? 'Dispatch QC overdue'
    : `${countdown.label} until QC due`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums ${TONE_CLASS[tone]}`}
      title={dispatchQcEta.qc_started_at
        ? `QC started ${new Date(dispatchQcEta.qc_started_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
        : undefined}
    >
      <Clock className="w-3.5 h-3.5 shrink-0" />
      {label}
    </span>
  );
}
