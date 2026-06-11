import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import { updateFollowUp } from '../leadCrmApi';
import toast from 'react-hot-toast';

export default function FollowUpWidget({ leadId, initialDate, initialTime, onSaved, compact = false }) {
  const [date, setDate] = useState(initialDate ? String(initialDate).slice(0, 10) : '');
  const [time, setTime] = useState(initialTime ? String(initialTime).slice(0, 5) : '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!date) {
      toast.error('Follow-up date is required');
      return;
    }
    setSaving(true);
    try {
      await updateFollowUp(leadId, {
        follow_up_date: date,
        follow_up_time: time || null,
        notes: notes || undefined,
      });
      toast.success('Follow-up updated');
      onSaved?.();
      setNotes('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update follow-up');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-xl border border-gray-100 bg-white shadow-sm ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-blue-600" />
        <h4 className="font-medium text-gray-900 text-sm">Schedule Follow-up</h4>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-500">Time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
            className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="mt-3">
        <label className="text-xs text-gray-500">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Optional notes..." />
      </div>
      <button type="button" onClick={handleSave} disabled={saving}
        className="mt-3 w-full sm:w-auto px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Saving...' : 'Save Follow-up'}
      </button>
    </div>
  );
}
