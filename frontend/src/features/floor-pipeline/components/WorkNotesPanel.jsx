import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { logTicketNote } from '../floorPipelineApi';

export default function WorkNotesPanel({ ticketId, activities = [], auditLog = [], onLogged }) {
  const [note, setNote] = useState('');
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const notes = [
    ...auditLog.filter((e) => e.event_type === 'note_added').map((e) => ({
      id: `audit-${e.log_id}`,
      at: e.created_at,
      who: e.actor_name_resolved || e.actor_name || 'System',
      text: e.description
    })),
    ...activities.filter((a) => a.action === 'note_added').map((a) => ({
      id: `act-${a.activity_id}`,
      at: a.created_at,
      who: a.user_name || 'User',
      text: a.notes
    }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (note.trim().length < 20) {
      toast.error('Please enter at least 20 characters');
      return;
    }
    const timeSpent = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
    setSubmitting(true);
    try {
      const { data } = await logTicketNote(ticketId, {
        note_text: note.trim(),
        time_spent_minutes: timeSpent || undefined
      });
      if (data.success) {
        toast.success('Work note added');
        setNote('');
        setHours(0);
        setMinutes(0);
        onLogged?.();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to log note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
        <h3 className="font-semibold text-slate-900">Log work done</h3>
        <label className="block text-sm">
          What did you do?*
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 min-h-[100px] text-sm"
            placeholder="Describe work completed (min 20 characters)…"
          />
        </label>
        <div className="flex gap-3 items-end text-sm">
          <label className="block">
            Hours
            <input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} className="mt-1 w-20 rounded border px-2 py-1.5" />
          </label>
          <label className="block">
            Minutes
            <input type="number" min={0} max={59} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="mt-1 w-20 rounded border px-2 py-1.5" />
          </label>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Add Note'}
        </button>
      </form>

      <section>
        <h3 className="font-semibold text-slate-900 mb-3 text-sm">Work Notes History</h3>
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="text-xs text-slate-500">{new Date(n.at).toLocaleString()} · {n.who}</p>
              <p className="mt-1 text-slate-800">{n.text}</p>
            </li>
          ))}
          {!notes.length ? <p className="text-sm text-slate-500">No work notes yet</p> : null}
        </ul>
      </section>
    </div>
  );
}
