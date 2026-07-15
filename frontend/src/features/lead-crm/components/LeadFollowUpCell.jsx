import React, { useState } from 'react';
import { formatFollowUpDateTime, followUpTone } from '../leadCrmUtils';
import SetFollowUpModal from './SetFollowUpModal';

export default function LeadFollowUpCell({ lead, onUpdated }) {
  const [open, setOpen] = useState(false);
  const tone = followUpTone(lead.followUpDate);
  const hasFollowUp = Boolean(lead.followUpDate);

  return (
    <>
      <div className="flex flex-col items-start gap-1 min-w-[100px]">
        {hasFollowUp ? (
          <span className={`text-xs whitespace-nowrap ${
            tone === 'overdue' ? 'text-red-600 font-medium'
              : tone === 'today' ? 'text-amber-600 font-medium'
                : 'text-gray-600'
          }`}>
            {formatFollowUpDateTime(lead.followUpDate, lead.followUpTime)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-indigo-600 hover:text-indigo-700 text-xs font-medium"
        >
          {hasFollowUp ? 'Update' : 'Set'}
        </button>
      </div>

      <SetFollowUpModal
        open={open}
        lead={lead}
        onClose={() => setOpen(false)}
        onSaved={onUpdated}
      />
    </>
  );
}
