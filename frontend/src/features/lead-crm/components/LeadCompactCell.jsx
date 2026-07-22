import React from 'react';
import { formatLeadContactLine, formatLeadPrimary } from '../leadCrmUtils';

export default function LeadCompactCell({ lead }) {
  return (
    <div className="min-w-[160px] max-w-xs">
      <p className="font-medium text-gray-900 truncate">{formatLeadPrimary(lead)}</p>
      <p className="text-xs text-gray-600 mt-0.5 truncate">{formatLeadContactLine(lead)}</p>
      {lead.email ? (
        <p className="text-[11px] text-gray-400 truncate mt-0.5">{lead.email}</p>
      ) : null}
    </div>
  );
}
