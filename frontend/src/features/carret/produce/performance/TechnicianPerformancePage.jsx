import React from 'react';
import DeskShell from '../../../../shells/DeskShell';
import { EmptyState, Notice, Tabs } from '../../../../components/carret';
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
      subtitle={view === 'qc'
        ? 'QC checks by each inspector across QC1, QC2 and Dispatch QC, what was missed, and the result against target — for the incentive.'
        : 'Laptops finished by each floor technician, how many passed QC, and the result against target — for the incentive.'}
    >
      <div className="c-stack">
        {tabs.length > 1 && <Tabs tabs={tabs} value={view} onChange={(v) => set({ view: v === 'qc' ? 'qc' : '' })} />}
        <PeriodBar period={period} />
        {isFuture && <Notice tone="info" title="This period has not started">Nothing to count yet.</Notice>}
        {!tabs.length && <EmptyState title="No access" />}
        {view === 'tech' && canTech && <TechniciansView from={from} to={to} isFuture={isFuture} />}
        {view === 'qc' && canQc && <QcInspectorsView from={from} to={to} isFuture={isFuture} />}
      </div>
    </DeskShell>
  );
}
