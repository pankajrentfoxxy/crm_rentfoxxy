import React from 'react';
import { Clock, X } from 'lucide-react';
import { isSnoozeActive } from '../../dispatch/dispatchAlertUtils';

function formatWhen(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function parseSnoozeRemark(notes) {
  if (!notes) return '—';
  const match = String(notes).match(/Remark:\s*(.+)$/i);
  return match ? match[1].trim() : notes;
}

function parseSnoozeDuration(notes) {
  if (!notes) return null;
  const match = String(notes).match(/snoozed for (\d+ minute[s]?)/i);
  return match ? match[1] : null;
}

export default function DispatchQcSnoozeActivityModal({
  open,
  onClose,
  activities = [],
  dispatchQcEta,
  snoozedUntil,
}) {
  if (!open) return null;

  const snoozeHistory = activities
    .filter((a) => a.action === 'dispatch_qc_snoozed')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const effectiveUntil = snoozedUntil || dispatchQcEta?.qc_alert_snoozed_until;
  const activeSnooze = isSnoozeActive(effectiveUntil);
  const currentRemark = dispatchQcEta?.qc_alert_snooze_remark;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-qc-snooze-activity-title"
        className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 id="dispatch-qc-snooze-activity-title" className="text-base font-bold text-slate-900">
              QC snooze activity
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Reminder snooze history and remarks for this ticket
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {activeSnooze ? (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Active snooze</p>
              <p className="mt-1 text-sky-900 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                Until {formatWhen(effectiveUntil)}
              </p>
              {currentRemark ? (
                <p className="mt-2 text-sky-950">
                  <span className="text-xs text-sky-700">Remark: </span>
                  {currentRemark}
                </p>
              ) : null}
            </div>
          ) : null}

          {snoozeHistory.length ? (
            <ul className="space-y-2">
              {snoozeHistory.map((entry) => (
                <li
                  key={entry.activity_id}
                  className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{formatWhen(entry.created_at)}</span>
                    <span>{entry.user_name || 'System'}</span>
                  </div>
                  {parseSnoozeDuration(entry.notes) ? (
                    <p className="mt-1 text-xs font-medium text-orange-700">
                      Snoozed for {parseSnoozeDuration(entry.notes)}
                    </p>
                  ) : null}
                  <p className="mt-1.5 text-slate-800">
                    <span className="text-xs text-slate-500">Remark: </span>
                    {parseSnoozeRemark(entry.notes)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 py-4 text-center">
              No snooze activity recorded yet.
            </p>
          )}
        </div>

        <div className="border-t px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
