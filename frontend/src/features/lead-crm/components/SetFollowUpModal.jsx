import React, { useEffect, useState } from 'react';
import { Calendar, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { addLeadRemark, updateFollowUp } from '../leadCrmApi';
import { leadDisplayLabel, followUpCalendarYmd } from '../leadCrmUtils';
import { refreshLeadCrmCounts } from '../hooks/useLeadCrmCounts';

export default function SetFollowUpModal({ open, lead, onClose, onSaved }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const hasExisting = Boolean(lead?.followUpDate);

  useEffect(() => {
    if (!lead || !open) return;
    setDate(followUpCalendarYmd(lead.followUpDate) || '');
    setTime(lead.followUpTime ? String(lead.followUpTime).slice(0, 5) : '');
    setNotes('');
  }, [lead, open]);

  if (!open || !lead) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const noteText = notes.trim();
    const clearing = !date;

    if (clearing && !hasExisting) {
      toast.error('Enter a follow-up date, or leave it empty to clear an existing one');
      return;
    }

    setSaving(true);
    try {
      if (clearing) {
        await updateFollowUp(lead.leadId, {
          follow_up_date: null,
          follow_up_time: null,
          notes: noteText || 'Follow-up cleared',
        });
        if (noteText) await addLeadRemark(lead.leadId, { note: noteText });
        toast.success('Follow-up cleared');
      } else {
        await updateFollowUp(lead.leadId, {
          follow_up_date: date,
          follow_up_time: time || null,
          notes: noteText || `Follow-up ${hasExisting ? 'updated' : 'scheduled'} for ${date}${time ? ` at ${time}` : ''}`,
        });
        if (noteText) await addLeadRemark(lead.leadId, { note: noteText });
        toast.success(hasExisting ? 'Follow-up updated' : 'Follow-up set');
      }
      onSaved?.();
      refreshLeadCrmCounts();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save follow-up');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="font-semibold text-gray-900">
                {hasExisting ? 'Update Follow-up' : 'Set Follow-up'}
              </h3>
              <p className="text-xs text-gray-500">{leadDisplayLabel(lead)}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Follow-up date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                const next = e.target.value;
                setDate(next);
                if (!next) setTime('');
              }}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            {hasExisting ? (
              <p className="text-[11px] text-gray-500 mt-1">
                Clear the date and click Save to remove this follow-up.
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Follow-up time</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!date}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Remark (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional note when saving or clearing..."
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
