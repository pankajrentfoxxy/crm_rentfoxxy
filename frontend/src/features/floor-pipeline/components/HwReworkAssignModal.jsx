import React, { useEffect, useState } from 'react';
import { Loader2, Star, User, X } from 'lucide-react';
import { getTeamMembers } from '../floorPipelineApi';
import { configSummary, priorityBadge, resolveTicketTtspl } from '../floorPipelineUi';

export default function HwReworkAssignModal({ ticket, open, onClose, onConfirm, confirming = false }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (!open || !ticket) return;
    setSelectedId(null);
    setLoading(true);
    getTeamMembers('Hardware & Software')
      .then(({ data }) => setMembers(data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [open, ticket]);

  if (!open || !ticket) return null;

  const pri = priorityBadge(ticket.priority);
  const recommendedId = members.length
    ? members.reduce((best, m) => ((m.active_tickets ?? 0) < (best.active_tickets ?? 0) ? m : best)).user_id
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-900">Assign Hardware &amp; Software Technician</h2>
            <p className="font-mono text-sm text-blue-700">{resolveTicketTtspl(ticket) || `#${ticket.ticket_id}`}</p>
            <p className="text-xs text-slate-500 mt-0.5">{configSummary(ticket)}</p>
            <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs font-semibold ${pri.className}`}>
              {pri.label}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-2 border-b text-sm font-medium text-slate-700 bg-slate-50">
          Hardware &amp; Software Team
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            QC1 failed — select the technician who will handle rework. The ticket will move to Assembly &amp; Software and be assigned to them.
          </p>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
          ) : !members.length ? (
            <p className="text-sm text-slate-500 text-center py-6">No Hardware &amp; Software team members found</p>
          ) : (
            members.map((m) => {
              const isRec = m.user_id === recommendedId;
              const isSelected = selectedId === m.user_id;
              return (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => setSelectedId(m.user_id)}
                  className={`w-full flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${
                    isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' :
                    isRec ? 'border-blue-200 bg-blue-50/50 hover:bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
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
                  {isSelected ? (
                    <span className="shrink-0 text-xs font-semibold text-blue-700">Selected</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <div className="border-t p-3 space-y-2">
          <button
            type="button"
            disabled={!selectedId || confirming}
            onClick={() => onConfirm(selectedId)}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {confirming ? 'Sending to Assembly…' : 'Assign & send to Assembly & Software'}
          </button>
          <button type="button" onClick={onClose} className="w-full py-2 rounded-lg border text-sm font-medium text-slate-600">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
