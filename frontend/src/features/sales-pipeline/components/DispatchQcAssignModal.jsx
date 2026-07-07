import React, { useEffect, useState } from 'react';
import { Loader2, Star, User, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  assignTicket,
  getTeamMembers,
  logTicketNote,
  updateTicket,
} from '../../floor-pipeline/floorPipelineApi';
import { configSummary, priorityBadge, resolveTicketTtspl } from '../../floor-pipeline/floorPipelineUi';

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export default function DispatchQcAssignModal({
  open,
  soNumber,
  ticket,
  serial,
  onClose,
  onAssigned,
}) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState('high');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !ticket) return;
    setAssigneeId('');
    setPriority(ticket.priority || 'high');
    setNotes('');
    setLoading(true);
    getTeamMembers('Dispatch QC Team')
      .then(({ data }) => setMembers(data.members || []))
      .catch(() => {
        setMembers([]);
        toast.error('Failed to load Dispatch QC users');
      })
      .finally(() => setLoading(false));
  }, [open, ticket]);

  if (!open || !ticket) return null;

  const pri = priorityBadge(ticket.priority || priority);
  const recommendedId = members.length
    ? members.reduce((best, m) => ((m.active_tickets ?? 0) < (best.active_tickets ?? 0) ? m : best)).user_id
    : null;
  const displayTicket = { ...ticket, ...serial };
  const ttspl = resolveTicketTtspl(displayTicket);
  const config = configSummary(displayTicket);

  const handleSkip = () => {
    if (!window.confirm('Leave this Dispatch QC ticket unassigned? You can assign it later from Floor Pipeline.')) {
      return;
    }
    onClose();
  };

  const handleAssign = async (e) => {
    e.preventDefault();
    if (!assigneeId) {
      toast.error('Select a Dispatch QC assignee');
      return;
    }
    setSubmitting(true);
    try {
      const member = members.find((m) => String(m.user_id) === String(assigneeId));
      const { data } = await assignTicket(ticket.ticket_id, { user_id: Number(assigneeId) });
      if (!data.success) throw new Error(data.message || 'Assignment failed');

      if (priority && priority !== (ticket.priority || 'high')) {
        await updateTicket(ticket.ticket_id, { priority });
      }
      if (notes.trim()) {
        await logTicketNote(ticket.ticket_id, { notes: notes.trim() });
      }

      toast.success(`Dispatch QC ticket assigned to ${member?.name || 'technician'}`);
      onAssigned?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Assignment failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close backdrop" onClick={handleSkip} />
      <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between border-b px-4 py-3 bg-orange-50 rounded-t-2xl sm:rounded-t-2xl">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Dispatch QC</p>
            <h2 className="font-semibold text-slate-900">Assign Dispatch QC ticket</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Laptop attached to <span className="font-mono font-medium text-slate-700">{soNumber}</span>
            </p>
          </div>
          <button type="button" onClick={handleSkip} className="p-2 rounded-lg hover:bg-orange-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleAssign} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-mono font-semibold text-blue-700">
                    {ttspl || `#${ticket.ticket_id}`}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pri.className}`}>
                    {pri.label}
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-orange-100 text-orange-800">
                    {ticket.stage_name || 'Dispatch QC'}
                  </span>
                </div>
                {serial?.serial_number && (
                  <p className="text-xs text-slate-600">
                    Serial: <span className="font-mono">{serial.serial_number}</span>
                  </p>
                )}
                {config && <p className="text-xs text-slate-500 mt-1">{config}</p>}
                <p className="text-xs text-slate-500 mt-1">
                  Sales order: <span className="font-mono">{soNumber}</span>
                  {ticket.ticket_id ? (
                    <> · Ticket <span className="font-mono">#{ticket.ticket_id}</span></>
                  ) : null}
                </p>
              </div>

              <div>
                <label htmlFor="dqc-assignee" className="block text-sm font-medium text-slate-700 mb-1">
                  Assignee <span className="text-red-500">*</span>
                </label>
                {loading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  </div>
                ) : !members.length ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    No Dispatch QC users found. Create users with the Dispatch QC role first.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <select
                      id="dqc-assignee"
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Select Dispatch QC inspector…</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.name}
                          {m.user_id === recommendedId ? ' ★ recommended' : ''}
                          {` (${m.active_tickets || 0} active)`}
                        </option>
                      ))}
                    </select>
                    {recommendedId && !assigneeId && (
                      <button
                        type="button"
                        onClick={() => setAssigneeId(String(recommendedId))}
                        className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                      >
                        <Star className="w-3 h-3" />
                        Use recommended: {members.find((m) => m.user_id === recommendedId)?.name}
                      </button>
                    )}
                    {assigneeId && (
                      <p className="text-xs text-slate-500 inline-flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {members.find((m) => String(m.user_id) === String(assigneeId))?.name}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="dqc-priority" className="block text-sm font-medium text-slate-700 mb-1">
                  Priority <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <select
                  id="dqc-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="dqc-notes" className="block text-sm font-medium text-slate-700 mb-1">
                  Notes <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="dqc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Special instructions for the Dispatch QC inspector…"
                  className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>

            <div className="border-t p-3 space-y-2">
              <button
                type="submit"
                disabled={submitting || !members.length}
                className="w-full py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
              >
                {submitting ? 'Assigning…' : 'Assign ticket'}
              </button>
              <button
                type="button"
                onClick={handleSkip}
                className="w-full py-2 rounded-lg border text-sm font-medium text-slate-500 hover:bg-slate-50"
              >
                Assign later
              </button>
            </div>
        </form>
      </div>
    </div>
  );
}
