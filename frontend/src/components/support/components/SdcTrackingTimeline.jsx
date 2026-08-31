import React from 'react';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { formatCreatedLabel } from '../utils';

function StepIcon({ step }) {
  if (step.key === 'rejected' || step.key === 'cancelled') {
    return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
  }
  if (step.done) return <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />;
  if (step.current) return <Circle className="w-4 h-4 text-amber-500 shrink-0 fill-amber-100" />;
  return <Circle className="w-4 h-4 text-slate-300 shrink-0" />;
}

export default function SdcTrackingTimeline({ sdc }) {
  const steps = sdc?.steps || [];
  if (!steps.length) return null;

  return (
    <ol className="mt-3 space-y-0">
      {steps.map((step, idx) => {
        const last = idx === steps.length - 1;
        const active = step.done || step.current;
        return (
          <li key={step.key} className="flex gap-2">
            <div className="flex flex-col items-center">
              <StepIcon step={step} />
              {!last ? (
                <span className={`w-px flex-1 min-h-[14px] ${step.done ? 'bg-teal-300' : 'bg-slate-200'}`} />
              ) : null}
            </div>
            <div className={`pb-3 min-w-0 ${last ? 'pb-0' : ''}`}>
              <p className={`text-xs font-semibold ${
                step.key === 'rejected' || step.key === 'cancelled'
                  ? 'text-red-700'
                  : step.current
                    ? 'text-amber-800'
                    : active
                      ? 'text-slate-800'
                      : 'text-slate-400'
              }`}>
                {step.label}
                {step.current ? (
                  <span className="ml-1.5 font-medium text-[10px] uppercase tracking-wide text-amber-700">
                    current
                  </span>
                ) : null}
              </p>
              {step.at ? (
                <p className="text-[11px] text-slate-500">
                  {formatCreatedLabel(step.at)}
                  {step.by ? ` · ${step.by}` : ''}
                </p>
              ) : step.current ? (
                <p className="text-[11px] text-slate-400">Waiting</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
