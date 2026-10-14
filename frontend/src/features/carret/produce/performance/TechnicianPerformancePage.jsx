import React from 'react';
import { useSearchParams } from 'react-router-dom';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, EmptyState, Input, Notice, Segmented, Tabs,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  PERIODS, istToday, periodRange, periodTitle, stepAnchor,
} from './perfShared';
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
  const [params, setParams] = useSearchParams();
  const kind = PERIODS.some((p) => p.value === params.get('period')) ? params.get('period') : 'day';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : istToday();
  const custom = { from: params.get('from') || anchor, to: params.get('to') || anchor };
  const { from, to } = kind === 'custom' ? custom : periodRange(kind, anchor);
  const view = params.get('view') === 'qc' ? (canQc ? 'qc' : 'tech') : (canTech ? 'tech' : 'qc');
  const isFuture = from > istToday();

  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

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
        <div className="c-perf-bar">
          <Segmented label="Period" value={kind} onChange={(v) => set({ period: v, from: v === 'custom' ? from : '', to: v === 'custom' ? to : '' })} options={PERIODS} />
          {kind !== 'custom' ? (
            <div className="c-perf-nav">
              <Button variant="quiet" aria-label="Previous" onClick={() => set({ date: stepAnchor(kind, anchor, -1) })}>‹</Button>
              <span className="c-perf-title">{periodTitle(kind, from, to)}</span>
              <Button variant="quiet" aria-label="Next" disabled={to >= istToday()} onClick={() => set({ date: stepAnchor(kind, anchor, 1) })}>›</Button>
              <Input type="date" value={anchor} max={istToday()} onChange={(e) => e.target.value && set({ date: e.target.value })} aria-label="Pick a date" style={{ maxWidth: '10rem' }} />
              {anchor !== istToday() && <Button variant="quiet" onClick={() => set({ date: '' })}>Today</Button>}
            </div>
          ) : (
            <div className="c-perf-nav">
              <Input type="date" value={from} max={istToday()} onChange={(e) => e.target.value && set({ from: e.target.value })} aria-label="From" style={{ maxWidth: '10rem' }} />
              <span className="text-ink-3">to</span>
              <Input type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} aria-label="To" style={{ maxWidth: '10rem' }} />
            </div>
          )}
        </div>
        {isFuture && <Notice tone="info" title="This period has not started">Nothing to count yet.</Notice>}
        {!tabs.length && <EmptyState title="No access" />}
        {view === 'tech' && canTech && <TechniciansView from={from} to={to} isFuture={isFuture} />}
        {view === 'qc' && canQc && <QcInspectorsView from={from} to={to} isFuture={isFuture} />}
      </div>
    </DeskShell>
  );
}
