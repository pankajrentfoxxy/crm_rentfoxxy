import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, Plus, RefreshCw } from 'lucide-react';
import {
  displayStatus,
  formatCreatedLabel,
  formatTicketId,
  formatUpdatedLabel,
  initials,
  isUrgentPickup,
  assigneeOptionLabel,
} from '../utils';

export default function TicketCard({ ticket, closed, technicians = [], canAssign, onAssigned }) {
  const navigate = useNavigate();
  const [openAssign, setOpenAssign] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const status = displayStatus(ticket);
  const urgent = isUrgentPickup(ticket.items);
  const techs = [...new Map((ticket.items || []).filter((i) => i.assigned_to_name).map((i) => [i.assigned_to, i.assigned_to_name])).values()];
  const canShowAssign = canAssign;
  const resolved = ticket.resolved_item_count || 0;
  const total = ticket.item_count || (ticket.items || []).length || 0;
  const hours = ticket.hours_since_last_update || 0;
  const updatedClass = ticket.is_overdue ? 'text-red-700' : hours >= 24 ? 'text-amber-700' : 'text-slate-500';

  const primaryCategory = ticket.ticket_category
    || (ticket.items || []).find((i) => i.item_type)?.item_type
    || 'complaint';

  const cardClass = [
    'support-ticket-card',
    `cat-${primaryCategory}`,
    closed ? 'closed' : '',
    !closed && ticket.is_overdue ? 'overdue' : '',
    !closed && urgent.urgent ? 'urgent' : ''
  ].filter(Boolean).join(' ');

  const assignAll = async (assignedTo) => {
    setAssigning(true);
    try {
      await onAssigned?.(ticket.id, assignedTo);
      setOpenAssign(false);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <article
      className={cardClass}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/support/tickets/${ticket.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/support/tickets/${ticket.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-slate-500 font-mono">{formatTicketId(ticket.id)}</span>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <span className={`support-category-label ${primaryCategory}`}>{primaryCategory}</span>
          {ticket.priority && ticket.priority !== 'normal' && (
            <span className="support-pill open text-[10px] uppercase">{ticket.priority}</span>
          )}
          <span className={`support-pill ${status.className}`}>{status.label}</span>
        </div>
      </div>
      <div className="mt-2 font-medium text-[14px]">{ticket.customer_name || 'Customer'}</div>
      <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
        <Phone className="w-3.5 h-3.5" />
        {ticket.display_phone || ticket.customer_phone || '—'}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(ticket.items || []).map((item) => (
          <span key={item.id} className={`support-machine-chip ${item.item_type}`}>
            {[item.brand, item.model, item.unique_serial_number || item.serial_number, item.item_type].filter(Boolean).join(' · ')}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full bg-[#639922]" style={{ width: `${total ? (resolved / total) * 100 : 0}%` }} />
        </div>
        <span className="text-[11px] text-slate-500 whitespace-nowrap">{resolved} of {total} resolved</span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-2 text-xs">
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {canShowAssign ? (
            <div className="relative">
              {techs.length ? (
                <div className="flex items-center gap-1 mb-1">
                  <div className="flex -space-x-2">
                    {techs.map((name) => (
                      <span key={name} className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold border border-white">
                        {initials(name)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <button type="button" className="support-btn-assign" disabled={assigning} onClick={() => setOpenAssign((v) => !v)}>
                <Plus className="w-3.5 h-3.5" /> {techs.length ? 'Reassign' : 'Assign'}
              </button>
              {openAssign && (
                <div className="absolute z-20 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                  {technicians.map((t) => (
                    <button
                      key={t.user_id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 min-h-[44px]"
                      onClick={() => assignAll(t.user_id)}
                    >
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px]">{initials(t.name)}</span>
                      <span className="text-sm">{assigneeOptionLabel(t)}</span>
                      <span className="text-xs text-slate-500 ml-auto">({t.open_ticket_count || 0})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : techs.length ? (
            <div className="flex -space-x-2">
              {techs.map((name) => (
                <span key={name} className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold border border-white">
                  {initials(name)}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-slate-500">Unassigned</span>
          )}
        </div>
        <div className="text-right space-y-1">
          <div className={`inline-flex items-center gap-1 ${updatedClass}`}>
            <RefreshCw className="w-3 h-3" />
            {formatUpdatedLabel(hours)}
          </div>
          <div className="text-[11px] text-slate-400">Created {formatCreatedLabel(ticket.created_at)}</div>
        </div>
      </div>
    </article>
  );
}
