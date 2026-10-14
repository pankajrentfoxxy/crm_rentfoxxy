import React from 'react';
import DeskShell from '../../../../shells/DeskShell';
import { EmptyState, Notice } from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import PeriodBar, { usePeriodParams } from './PeriodBar';
import TechniciansView from './TechniciansView';
import QcInspectorsView from './QcInspectorsView';

/**
 * Production → Floor performance: the incentive dashboards.
 *
 *   Technicians    (technician_performance, migration 415) — laptops finished
 *                  through Final Testing, QC result, correct vs target
 *   QC inspectors  (qc_performance, migration 423) — QC1 / QC2 / Dispatch QC
 *                  checks (people rotate), missed defects, correct vs target
 *
 * One period control for both; each tab shows only to people allowed to see
 * it. ?view=qc opens the QC tab.
 */
export default function TechnicianPerformancePage() {
  const { hasPermission } = usePermission();
  const canTech = hasPermission('technician_performance', 'view');
  const canQc = hasPermission('qc_performance', 'view');
  const period = usePeriodParams();
  const { from, to, params, set, isFuture } = period;
  const view = params.get('view') === 'qc' ? (canQc ? 'qc' : 'tech') : (canTech ? 'tech' : 'qc');

  const tabs = [
    ...(canTech ? [{ key: 'tech', label: 'Technicians' }] : []),
    ...(canQc ? [{ key: 'qc', label: 'QC inspectors' }] : []),
  ];

  return (
    <DeskShell
      title="Floor performance"
      breadcrumb="Production"
      subtitle="Work done, QC result and incentive against target."
    >
      <div className="c-stack">
        <div className="c-pf-toolbar">
          {tabs.length > 1 ? (
            <div className="c-pf-switch" role="tablist" aria-label="Team">
              {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={view === t.key} className={view === t.key ? 'is-on' : ''} onClick={() => set({ view: t.key === 'qc' ? 'qc' : '' })}>{t.label}</button>
              ))}
            </div>
          ) : <span />}
          <PeriodBar period={period} />
        </div>
        {isFuture && <Notice tone="info" title="This period has not started">Nothing to count yet.</Notice>}
        {!tabs.length && <EmptyState title="No access" />}
        {view === 'tech' && canTech && <TechniciansView from={from} to={to} isFuture={isFuture} />}
        {view === 'qc' && canQc && <QcInspectorsView from={from} to={to} isFuture={isFuture} />}
      </div>
    </DeskShell>
  );
}
