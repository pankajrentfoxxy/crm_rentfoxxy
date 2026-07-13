import React, { useEffect, useState } from 'react';
import { Calendar, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateFollowUp } from '../leadCrmApi';
import { leadDisplayLabel } from '../leadCrmUtils';

export default function SetFollowUpModal({ open, lead, onClose, onSaved }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lead || !open) return;
    setDate(lead.followUpDate ? String(lead.followUpDate).slice(0, 10) : '');
    setTime(lead.followUpTime ? String(lead.followUpTime).slice(0, 5) : '');
  }, [lead, open]);

  if (!open || !lead) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!date) {
      toast.error('Follow-up date is required');
      return;
    }
    setSaving(true);
    try {
      await updateFollowUp(lead.leadId, {
        follow_up_date: date,
        follow_up_time: time || null,
        notes: `Follow-up scheduled for ${date}${time ? ` at ${time}` : ''}`,
      });
      toast.success('Follow-up set');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to set follow-up');
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
              <h3 className="font-semibold text-gray-900">Mark Follow-up</h3>
              <p className="text-xs text-gray-500">{leadDisplayLabel(lead)}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Follow-up date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Follow-up time</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
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
