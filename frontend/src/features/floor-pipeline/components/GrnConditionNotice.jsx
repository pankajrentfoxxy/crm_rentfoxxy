import React from 'react';
import { AlertTriangle, PowerOff, PackageX } from 'lucide-react';
import { conditionLabel, partCategoryLabels } from '../../../constants/laptopConditions';

function parseMissingParts(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Compact badge for ticket cards. Renders nothing for normal powered-on intake. */
export function GrnConditionBadge({ ticket }) {
  const condition = ticket?.received_condition;
  if (!condition || condition === 'on') return null;
  const isNotOn = condition === 'not_on';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        isNotOn ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'
      }`}
    >
      {isNotOn ? <PowerOff className="w-3 h-3" /> : <PackageX className="w-3 h-3" />}
      {conditionLabel(condition)}
    </span>
  );
}

/**
 * Full intake notice for the ticket detail page. Spells out the missing part
 * categories so the technician knows exactly which part requests to raise.
 */
export default function GrnConditionNotice({ ticket }) {
  const condition = ticket?.received_condition;
  if (!condition || condition === 'on') return null;

  const missing = partCategoryLabels(parseMissingParts(ticket.missing_parts));
  const isNotOn = condition === 'not_on';

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        isNotOn ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={`w-4 h-4 shrink-0 mt-0.5 ${isNotOn ? 'text-rose-600' : 'text-amber-600'}`}
        />
        <div className="min-w-0">
          <p className={`m-0 text-sm font-semibold ${isNotOn ? 'text-rose-900' : 'text-amber-900'}`}>
            Received at GRN as “{conditionLabel(condition)}”
          </p>
          {isNotOn ? (
            <p className="m-0 mt-1 text-xs text-rose-800">
              This laptop did not power on at goods receipt, so its configuration was never verified
              against the vendor. Diagnose the power fault before running QC.
            </p>
          ) : (
            <>
              <p className="m-0 mt-1 text-xs text-amber-900">
                These parts were missing when the laptop arrived — raise a part request for each one
                from the Parts tab.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {missing.length ? (
                  missing.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-300 px-2.5 py-1 text-xs font-semibold text-amber-900"
                    >
                      <PackageX className="w-3 h-3" />
                      {label}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-amber-800">Part list not recorded at GRN.</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
