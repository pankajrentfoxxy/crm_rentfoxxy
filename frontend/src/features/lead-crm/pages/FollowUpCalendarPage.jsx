import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { getFollowUps } from '../leadCrmApi';
import { STATUS_COLORS } from '../leadConstants';
import SetFollowUpModal from '../components/SetFollowUpModal';

function followUpDueAt(lead) {
  if (!lead?.followUpDate) return null;
  const d = new Date(lead.followUpDate);
  if (lead.followUpTime) {
    const [h, m] = String(lead.followUpTime).split(':');
    d.setHours(parseInt(h, 10) || 0, parseInt(m, 10) || 0, 0, 0);
  }
  return d;
}

function getFollowUpState(lead) {
  const due = followUpDueAt(lead);
  if (!due) return 'normal';
  const diff = due.getTime() - Date.now();
  if (diff < 0) return 'overdue';
  if (diff <= 10 * 60 * 1000) return 'upcoming_10m';
  return 'normal';
}

function formatFollowUpCell(lead) {
  const due = followUpDueAt(lead);
  if (!due) return '—';
  const dateStr = due.toLocaleDateString('en-IN');
  const timeStr = due.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return (
    <div className="leading-tight">
      <div>{dateStr} {timeStr}</div>
    </div>
  );
}

function FollowUpTable({ items, variant, onUpdateFollowUp }) {
  const isOverdue = variant === 'overdue';

  return (
    <div className="overflow-x-auto min-w-0">
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col className="w-[16%]" />
          <col className="w-[16%]" />
          <col className="w-[11%]" />
          <col className="w-[13%]" />
          <col className="w-[22%]" />
          <col className="w-[15%]" />
        </colgroup>
        <thead className="bg-slate-50">
          <tr>
            {['Lead', 'Company', 'Status', 'Assignee', 'Follow-up', 'Action'].map((label) => (
              <th
                key={label}
                className="px-2 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((lead) => {
            const state = getFollowUpState(lead);
            const st = STATUS_COLORS[lead.status] || STATUS_COLORS.Pending;

            return (
              <tr
                key={lead.leadId}
                className={`border-t border-slate-100 hover:bg-slate-50/50 transition-colors ${
                  state === 'overdue' ? 'bg-red-50/50' : state === 'upcoming_10m' ? 'bg-emerald-50/50' : ''
                }`}
              >
                <td className="px-2 py-2 truncate" title={lead.name}>
                  <Link
                    to={`/lead-crm/leads/${lead.leadId}`}
                    state={{ focusTab: 2, fromFollowUps: true }}
                    className="text-slate-800 hover:text-blue-600 hover:underline font-medium"
                  >
                    {lead.name || '—'}
                  </Link>
                </td>
                <td className="px-2 py-2 text-slate-600 truncate" title={lead.companyName || ''}>
                  {lead.companyName || '—'}
                </td>
                <td className="px-2 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.bg} ${st.text}`}>
                    {lead.status}
                  </span>
                </td>
                <td className="px-2 py-2 text-slate-600 truncate" title={lead.assignedUser?.name || ''}>
                  {lead.assignedUser?.name || '—'}
                </td>
                <td className={`px-2 py-2 align-top ${isOverdue || state === 'overdue' ? 'text-red-600' : 'text-slate-600'}`}>
                  {formatFollowUpCell(lead)}
                  {state === 'upcoming_10m' && (
                    <div className="text-xs text-emerald-600 font-medium mt-0.5">Due in 10 min</div>
                  )}
                  {(isOverdue || state === 'overdue') && (
                    <div className="text-xs text-red-600 font-medium mt-0.5">Overdue</div>
                  )}
                </td>
                <td className="px-2 py-2 align-top">
                  <button
                    type="button"
                    onClick={() => onUpdateFollowUp(lead)}
                    className="text-indigo-600 hover:text-indigo-700 font-medium text-xs"
                  >
                    Update
                  </button>
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-6 text-center text-slate-500 text-sm">
                No follow-ups found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function FollowUpCalendarPage() {
  const [today, setToday] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editLead, setEditLead] = useState(null);

  const loadFollowUps = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getFollowUps();
      if (!data?.success) throw new Error(data?.message || 'Failed to load follow-ups');
      setToday(data.today || []);
      setOverdue(data.overdue || []);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFollowUps();
  }, [loadFollowUps]);

  if (loading) {
    return <div className="text-center py-12 text-slate-500 text-sm">Loading follow-ups…</div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-medium text-slate-800 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-600" />
          Follow-ups
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">Today and overdue follow-ups</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
            <h3 className="text-xs font-medium text-slate-600">Today ({today.length})</h3>
          </div>
          <FollowUpTable items={today} variant="today" onUpdateFollowUp={setEditLead} />
        </div>

        <div className="border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm">
          <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <h3 className="text-xs font-medium text-amber-800">Overdue ({overdue.length})</h3>
          </div>
          <FollowUpTable items={overdue} variant="overdue" onUpdateFollowUp={setEditLead} />
        </div>
      </div>

      <SetFollowUpModal
        open={Boolean(editLead)}
        lead={editLead}
        onClose={() => setEditLead(null)}
        onSaved={loadFollowUps}
      />
    </div>
  );
}
