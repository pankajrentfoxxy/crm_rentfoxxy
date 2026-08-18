import React from 'react';
import { Button, Mono, WorkOrderCard } from '../../../components/ui/supportPrimitives';
import PermissionGate from '../../../components/PermissionGate';

function slotLabel(w) {
  if (!w?.scheduled_start) return '';
  const d = new Date(w.scheduled_start);
  return d.toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function ReplacementPair({ pair, workOrders, onOpenWo, onWaive, blocked }) {
  const delivery = workOrders.find((w) => w.wo_id === pair.delivery_wo_id);
  const collect = workOrders.find((w) => w.wo_id === pair.collect_wo_id);
  const group = String(pair.replacement_group_id || '').slice(0, 8);
  const collectBlocked = Boolean(
    collect
    && delivery
    && delivery.status !== 'COMPLETED'
    && collect.status !== 'COMPLETED'
    && collect.status !== 'CANCELLED'
    && !pair.collect_waived
  );

  return (
    <div className="rounded-[10px] border border-sup-lineSoft bg-white p-2 space-y-1.5">
      <div className="flex items-center justify-between px-1 text-[11px] uppercase tracking-wide text-sup-faint font-semibold">
        <span>Replacement pair</span>
        <Mono>group {group}</Mono>
      </div>
      {delivery && (
        <WorkOrderCard
          woNumber={delivery.wo_number}
          type={delivery.wo_type}
          status={delivery.status}
          assignee={delivery.assigned_to_name}
          slot={slotLabel(delivery)}
          documentNumber={delivery.document_number}
          stepsDone={(delivery.steps || []).filter((s) => s.status === 'DONE').length}
          stepsTotal={(delivery.steps || []).length}
          onClick={() => onOpenWo(delivery.wo_id)}
        />
      )}
      {collect && (
        <div className={collectBlocked || blocked ? 'ring-1 ring-pri2 rounded-[10px]' : ''}>
          <WorkOrderCard
            woNumber={collect.wo_number}
            type={collect.wo_type}
            status={collect.status}
            assignee={collect.assigned_to_name}
            slot={pair.collect_waived ? 'waived order' : (delivery ? 'same visit' : slotLabel(collect))}
            documentNumber={collect.document_number}
            stepsDone={(collect.steps || []).filter((s) => s.status === 'DONE').length}
            stepsTotal={(collect.steps || []).length}
            onClick={() => onOpenWo(collect.wo_id)}
          />
          {collectBlocked && (
            <div className="px-3 pb-2 text-[11px] text-pri2">
              Deliver the replacement before collecting the old unit.
              <PermissionGate section="support_replacement" action="edit">
                <Button size="sm" variant="ghost" className="ml-2" onClick={() => onWaive(pair)}>
                  Waive collect
                </Button>
              </PermissionGate>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
