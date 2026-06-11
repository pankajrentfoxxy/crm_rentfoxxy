import React from 'react';
import { KANBAN_STAGES } from '../floorPipelineUi';

export default function StageTimeline({ currentStage }) {
  const idx = KANBAN_STAGES.indexOf(currentStage);
  return (
    <ol className="flex flex-wrap gap-1">
      {KANBAN_STAGES.map((stage, i) => {
        const done = idx >= 0 && i < idx;
        const active = stage === currentStage;
        return (
          <li
            key={stage}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              active
                ? 'bg-blue-600 text-white'
                : done
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-500'
            }`}
            title={stage}
          >
            {stage}
          </li>
        );
      })}
    </ol>
  );
}
