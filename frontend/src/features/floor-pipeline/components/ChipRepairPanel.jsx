import React from 'react';
import ChipLevelRepairPanel from '../../../components/ChipLevelRepairPanel';

export default function ChipRepairPanel(props) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-4">
      <h3 className="font-semibold text-amber-900 mb-3">Chip Level Repair</h3>
      <ChipLevelRepairPanel {...props} />
    </div>
  );
}
