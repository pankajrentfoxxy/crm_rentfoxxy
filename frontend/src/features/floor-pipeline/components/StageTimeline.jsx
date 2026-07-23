import React, { useMemo } from 'react';
import { KANBAN_STAGES, computeStageStatuses, STAGE_TIMELINE_STYLES, formatStageDisplayName } from '../floorPipelineUi';

export default function StageTimeline({ currentStage, ticket = null }) {
  const statuses = useMemo(
    () => computeStageStatuses(currentStage, ticket || {}),
    [currentStage, ticket]
  );

  return (
    <ol className="flex flex-wrap gap-1">
      {KANBAN_STAGES.map((stage) => {
        const state = statuses[stage] || 'pending';
        return (
          <li
            key={stage}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STAGE_TIMELINE_STYLES[state] || STAGE_TIMELINE_STYLES.pending}`}
            title={formatStageDisplayName(stage)}
          >
            {formatStageDisplayName(stage)}
          </li>
        );
      })}
    </ol>
  );
}
