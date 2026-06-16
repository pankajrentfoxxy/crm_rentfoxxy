import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { updateLeadStatus } from '../leadCrmApi';
import { LEAD_STATUSES, STAGES_BY_STATUS, STATUS_COLORS } from '../leadConstants';

export default function QuickStatusUpdate({ lead, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(lead.status);
  const [stage, setStage] = useState(lead.leadStage || '');
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    setStatus(lead.status);
    setStage(lead.leadStage || '');
  }, [lead.status, lead.leadStage]);

  useEffect(() => {
    const stages = STAGES_BY_STATUS[status] || [];
    setStage(stages.length === 1 ? stages[0] : '');
  }, [status]);

  const stages = STAGES_BY_STATUS[status] || [];
  const needsStage = stages.length > 0;

  const handleSave = async () => {
    if (needsStage && !stage) {
      toast.error('Please select a stage');
      return;
    }
    setSaving(true);
    try {
      await updateLeadStatus(lead.leadId, {
        status,
        lead_stage: stage || null,
        notes: `Status updated to ${status}${stage ? ` / ${stage}` : ''} via quick update`,
      });
      toast.success('Status updated');
      setOpen(false);
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const st = STATUS_COLORS[lead.status] || STATUS_COLORS.Pending;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all ${st.bg} ${st.text}`}
        title="Click to update status"
      >
        {lead.status}
        <span className="ml-1 opacity-60">▾</span>
      </button>

      {open ? (
        <div
          className="absolute z-50 left-0 top-full mt-1 w-64 rounded-xl border border-gray-200 bg-white shadow-xl p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Update Status
          </p>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full border rounded-lg px-2 py-1.5 text-sm mb-2 focus:ring-2 focus:ring-blue-500"
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {needsStage ? (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Stage
              </p>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full border rounded-lg px-2 py-1.5 text-sm mb-2 focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select stage…</option>
                {stages.map((sg) => (
                  <option key={sg} value={sg}>{sg}</option>
                ))}
              </select>
            </>
          ) : null}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 py-1.5 rounded-lg text-xs border hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || (needsStage && !stage)}
              className="flex-1 py-1.5 rounded-lg text-xs bg-blue-600 text-white font-semibold disabled:opacity-50 hover:bg-blue-700"
            >
              {saving ? 'Saving…' : 'Update'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
