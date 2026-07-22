import React from 'react';
import { resolveLeadConfigDisplay } from '../leadCrmUtils';

/** Ticket / SO-style config card — brand-model, screen, pipe-separated specs */
export default function LeadConfigCell({ lead }) {
  const { title, screenLine, specLine } = resolveLeadConfigDisplay(lead);

  if (!title && !screenLine && !specLine) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm min-w-[200px] max-w-[280px]">
      {title ? (
        <p className="font-semibold text-blue-900 text-xs leading-snug">{title}</p>
      ) : null}
      {screenLine ? (
        <p className="text-xs text-gray-500 mt-0.5">| {screenLine}</p>
      ) : null}
      {specLine ? (
        <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{specLine}</p>
      ) : null}
    </div>
  );
}
