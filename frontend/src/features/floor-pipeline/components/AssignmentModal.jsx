import React, { useEffect, useState } from 'react';
import { Loader2, Star, User, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { assignTicket, getTeamMembers } from '../floorPipelineApi';
import { configSummary, priorityBadge } from '../floorPipelineUi';

const TEAMS = [
  { key: 'hw', label: 'Hardware & Software Team', teamName: 'Hardware & Software' },
  { key: 'qc', label: 'QC Team', teamName: 'QC Team' }
];

export default function AssignmentModal({ ticket, open, onClose, onAssigned }) {
  const [tab, setTab] = useState('hw');
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(null);

  const team = TEAMS.find((t) => t.key === tab) || TEAMS[0];
  const isSalesQc = ticket?.ticket_type === 'sales_order_qc' || ticket?.priority === 'sales_order';

  useEffect(() => {
    if (!open || !ticket) return;
    if (isSalesQc) setTab('qc');
    setLoading(true);
    getTeamMembers(team.teamName)
      .then(({ data }) => setMembers(data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [open, ticket, team.teamName, isSalesQc]);

  if (!open || !ticket) return null;

  const pri = priorityBadge(ticket.priority);
  const recommendedId = members.length
    ? members.reduce((best, m) => ((m.active_tickets ?? 0) < (best.active_tickets ?? 0) ? m : best)).user_id
    : null;

  const handleAssign = async (userId) => {
    setAssigning(userId);
    try {
      const { data } = await assignTicket(ticket.ticket_id, { user_id: userId });
      if (data.success) {
        toast.success(`Assigned to ${members.find((m) => m.user_id === userId)?.name || 'technician'}`);
        onAssigned?.();
        onClose();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Assignment failed');
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-900">Assign Ticket</h2>
            <p className="font-mono text-sm text-blue-700">{ticket.ttspl_id || `#${ticket.ticket_id}`}</p>
            <p className="text-xs text-slate-500 mt-0.5">{configSummary(ticket)}</p>
            <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs font-semibold ${pri.className}`}>
              {pri.label}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b text-sm">
          {TEAMS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 font-medium ${tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-500'}`}
            >
              {t.label.replace(' Team', '')}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isSalesQc && tab === 'hw' ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Sales Order QC tickets are usually assigned directly to the QC team.
            </p>
          ) : null}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
          ) : !members.length ? (
            <p className="text-sm text-slate-500 text-center py-6">No team members found</p>
          ) : (
            members.map((m) => {
              const isRec = m.user_id === recommendedId;
              return (
                <div
                  key={m.user_id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${isRec ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200'}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <p className="font-medium text-sm truncate">{m.name}</p>
                      <p className="text-xs text-slate-500">
                        {m.active_tickets || 0} active ticket{(m.active_tickets || 0) !== 1 ? 's' : ''}
                        {isRec ? (
                          <span className="ml-1 text-blue-600 inline-flex items-center gap-0.5">
                            <Star className="w-3 h-3" /> recommended
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={assigning === m.user_id}
                    onClick={() => handleAssign(m.user_id)}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {assigning === m.user_id ? '…' : 'Assign'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t p-3">
          <button type="button" onClick={onClose} className="w-full py-2 rounded-lg border text-sm font-medium text-slate-600">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
