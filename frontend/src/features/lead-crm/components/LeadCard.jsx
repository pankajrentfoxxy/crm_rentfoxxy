import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GripVertical } from 'lucide-react';
import { STATUS_COLORS } from '../leadConstants';
import { formatConfig, formatCurrency, formatFollowUpDateTime, formatInquiry, followUpTone, leadDisplayLabel, relativeTime } from '../leadCrmUtils';
import QuickStatusUpdate from './QuickStatusUpdate';

export default function LeadCard({ lead, onDragStart, onDragEnd, onRefresh }) {
  const navigate = useNavigate();
  const statusStyle = STATUS_COLORS[lead.status] || STATUS_COLORS.Pending;
  const fuTone = followUpTone(lead.followUpDate);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart?.(e, lead)}
      onDragEnd={onDragEnd}
      onClick={() => navigate(`/lead-crm/leads/${lead.leadId}`)}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow text-sm"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="w-4 h-4 text-gray-300 shrink-0 mt-0.5 cursor-grab" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
              {formatInquiry(lead.inquiryType)}
            </span>
            {lead.followUpDate && (
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                fuTone === 'overdue' ? 'bg-red-500' : fuTone === 'today' ? 'bg-amber-500' : 'bg-blue-400'
              }`} title="Follow-up" />
            )}
          </div>
          <p className="font-semibold text-gray-900 truncate">{leadDisplayLabel(lead)}</p>
          <p className="text-gray-500 text-xs truncate">
            {(lead.name && lead.name !== 'Website Enquiry' ? lead.name : lead.email || '—')}{lead.designation ? ` · ${lead.designation}` : ''}
          </p>
          <p className="text-xs text-gray-500 mt-1 truncate">📞 {lead.phone || '—'}</p>
          {lead.email && <p className="text-xs text-gray-400 truncate">📧 {lead.email}</p>}
          <hr className="my-2 border-gray-100" />
          <p className="text-xs text-gray-600">Config: {formatConfig(lead)}</p>
          <p className="text-xs text-gray-600">
            Qty: {lead.quantityRequired || '—'} units
            {lead.monthlyBudget != null ? ` · Budget: ${formatCurrency(lead.monthlyBudget)}/mo` : ''}
          </p>
          <hr className="my-2 border-gray-100" />
          <p className="text-xs text-gray-500">City: {lead.city || '—'} · Source: {lead.source || '—'}</p>
          {lead.leadStage && (
            <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
              {lead.leadStage}
            </span>
          )}
          <hr className="my-2 border-gray-100" />
          <p className="text-xs text-gray-500">👤 {lead.assignedUser?.name || 'Unassigned'}</p>
          <p className={`text-xs mt-0.5 ${fuTone === 'overdue' ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
            ⏰ {formatFollowUpDateTime(lead.followUpDate, lead.followUpTime)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            🕐 {relativeTime(lead.lastActivityAt || lead.updatedAt)}
          </p>
          <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <QuickStatusUpdate lead={lead} onUpdated={onRefresh} />
            <span className="text-xs text-gray-400">{lead.leadStage || ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
