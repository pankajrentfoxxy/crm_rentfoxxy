import React from 'react';
import QC1Form from '../../../components/QC1Form';

/** QC1 + QC2 checklist — reuses existing QC1Form with round label */
export default function QcChecklistPanel({ ticket, stageName, onSubmitted }) {
  const qcStage = stageName === 'QC2' ? 'QC2' : 'QC1';
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-slate-900 mb-1">{qcStage} Checklist</h3>
      <p className="text-xs text-slate-500 mb-4">
        Hardware and software verification. On fail, a reason is required before sending back.
      </p>
      <QC1Form ticket={ticket} qcStage={qcStage} onComplete={onSubmitted} />
    </div>
  );
}
