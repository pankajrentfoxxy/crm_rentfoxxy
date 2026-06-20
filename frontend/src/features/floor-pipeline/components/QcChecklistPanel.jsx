import React from 'react';
import QC1Form from '../../../components/QC1Form';

/** QC checklist — reuses QC1Form for QC1 / QC2 / Dispatch QC (label + routing follow the actual stage) */
export default function QcChecklistPanel({ ticket, stageName, onSubmitted }) {
  // Use the actual stage so Dispatch QC isn't mislabelled "QC1" and doesn't route to QC2.
  const qcStage = ['QC1', 'QC2', 'Dispatch QC'].includes(stageName) ? stageName : 'QC1';
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
