import React from 'react';
import { AlertTriangle, Clock, User, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { configSummary, priorityBadge, ticketAgeDays } from '../floorPipelineUi';

export default function TicketCard({ ticket, pendingParts, onCardClick }) {
  const pri = priorityBadge(ticket.priority);
  const className = 'block w-full text-left rounded-xl border border-gray-100 bg-white p-3 shadow-sm hover:shadow-md transition-shadow';
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pri.className}`}>
          {pri.label}
        </span>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
          {ticket.stage_name}
        </span>
      </div>
      <p className="font-mono font-bold text-slate-900 text-sm">{ticket.ttspl_id || ticket.machine_number || '—'}</p>
      <p className="text-xs text-slate-600 mt-1 line-clamp-2">{configSummary(ticket)}</p>
      {ticket.highlighted ? (
        <div className="mt-2 flex gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5 text-xs text-amber-900">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{ticket.highlighted_reason || 'Needs attention'}</span>
        </div>
      ) : null}
      <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <User className="w-3 h-3" />
          {ticket.assigned_user_name || 'Unassigned'}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {ticketAgeDays(ticket.created_at)}
        </span>
      </div>
      {pendingParts ? (
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
          <Wrench className="w-3 h-3" />
          Parts pending
        </span>
      ) : null}
    </>
  );

  if (onCardClick) {
    return (
      <button type="button" onClick={() => onCardClick(ticket)} className={className}>
        {inner}
      </button>
    );
  }
  return (
    <Link to={`/floor-pipeline/tickets/${ticket.ticket_id}`} className={className}>
      {inner}
    </Link>
  );
}
