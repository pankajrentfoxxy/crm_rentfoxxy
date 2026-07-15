import React, { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import { addLeadRemark, updateFollowUp } from '../leadCrmApi';
import toast from 'react-hot-toast';
import { followUpCalendarYmd } from '../leadCrmUtils';
import { refreshLeadCrmCounts } from '../hooks/useLeadCrmCounts';

export default function FollowUpWidget({ leadId, initialDate, initialTime, onSaved, compact = false }) {
  const [date, setDate] = useState(followUpCalendarYmd(initialDate) || '');
  const [time, setTime] = useState(initialTime ? String(initialTime).slice(0, 5) : '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const hasExisting = Boolean(initialDate);

  useEffect(() => {
    setDate(followUpCalendarYmd(initialDate) || '');
    setTime(initialTime ? String(initialTime).slice(0, 5) : '');
  }, [initialDate, initialTime]);

  const handleSave = async () => {
    const noteText = notes.trim();
    const clearing = !date;

    if (clearing && !hasExisting) {
      toast.error('Enter a follow-up date, or leave it empty to clear an existing one');
      return;
    }

    setSaving(true);
    try {
      if (clearing) {
        await updateFollowUp(leadId, {
          follow_up_date: null,
          follow_up_time: null,
          notes: noteText || 'Follow-up cleared',
        });
        if (noteText) await addLeadRemark(leadId, { note: noteText });
        toast.success('Follow-up cleared');
      } else {
        await updateFollowUp(leadId, {
          follow_up_date: date,
          follow_up_time: time || null,
          notes: noteText || `Follow-up ${hasExisting ? 'updated' : 'scheduled'} for ${date}${time ? ` at ${time}` : ''}`,
        });
        if (noteText) await addLeadRemark(leadId, { note: noteText });
        toast.success(hasExisting ? 'Follow-up updated' : 'Follow-up set');
      }
      setNotes('');
      onSaved?.();
      refreshLeadCrmCounts();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save follow-up');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-xl border border-gray-100 bg-white shadow-sm ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-blue-600" />
        <h4 className="font-medium text-gray-900 text-sm">
          {hasExisting ? 'Update Follow-up' : 'Schedule Follow-up'}
        </h4>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">Date</label>
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
          <label className="text-xs text-gray-500">Time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={!date}
            className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
          />
        </div>
      </div>
      <div className="mt-3">
        <label className="text-xs text-gray-500">Remark (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
          placeholder="Optional note when saving or clearing..."
        />
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}
