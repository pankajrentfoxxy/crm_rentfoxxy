import React, { useEffect, useState } from 'react';
import DeskShell from '../../../../shells/DeskShell';
import {
  EmptyState, Notice, Section, Tabs,
} from '../../../../components/carret';
import api from '../../../../utils/api';
import PeriodBar, { usePeriodParams } from './PeriodBar';
import { Standing, TargetMeter } from './perfShared';
import { TechnicianJobs } from './TechnicianDrawer';
import { QcChecks } from './QcInspectorDrawer';

/**
 * Production → My performance (migration 427): a floor technician's or QC
 * inspector's own numbers — the same figures their manager sees on Floor
 * performance, for the signed-in person only (GET /api/my-performance never
 * takes a user id). The list behind each number shows why a laptop failed QC,
 * so the page is also where to learn from it.
 */
function Headline({ title, unit, d }) {
  const t = d.totals;
  const target = t.target;
  const failed = unit === 'jobs' ? t.failed : t.missed;
  const pending = unit === 'jobs' ? t.awaiting : t.open;
  return (
    <Section title={title}>
      <div className="c-my-head">
        <div>
          <div className="c-my-big"><b>{t.correct}</b>{target ? <span> / {target}</span> : null}</div>
          <div className="text-ink-3" style={{ fontSize: '13px' }}>
            correct {unit} {target ? 'against your target' : '— no target set for you'}
          </div>
        </div>
        <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
          <TargetMeter correct={t.correct} failed={failed} awaiting={pending} target={target} />
          <Standing s={d.standing} eligible={d.eligible} provisional={pending > 0} />
          <p className="text-ink-3" style={{ margin: '6px 0 0', fontSize: '13px' }}>
            {unit === 'jobs'
              ? `Correct = laptops you finished (${t.completed}) − those that failed QC (${t.failed}).${t.awaiting ? ` ${t.awaiting} still waiting for QC — this can still change.` : ''}${t.reworks ? ` Reworks (${t.reworks}) don't count.` : ''}`
              : `Correct = your QC checks (${t.checks}) − passes that were missed (${t.missed}).${t.open ? ` ${t.open} passes are still in their window — this can still change.` : ''}`}
          </p>
        </div>
      </div>
    </Section>
  );
}

export default function MyPerformancePage() {
  const period = usePeriodParams();
  const { from, to, params, set, isFuture } = period;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setData(null);
    api.get('/my-performance', { params: { from, to } })
      .then(({ data: d }) => { if (live) { setData(d.data); setError(''); } })
      .catch((e) => { if (live) setError(e?.response?.data?.message || 'Could not load your performance'); });
    return () => { live = false; };
  }, [from, to]);

  const tabs = [
    ...(data?.technician ? [{ key: 'tech', label: 'My jobs' }] : []),
    ...(data?.qc ? [{ key: 'qc', label: 'My QC checks' }] : []),
  ];
  const view = params.get('view') === 'qc' && data?.qc ? 'qc' : (data?.technician ? 'tech' : 'qc');

  return (
    <DeskShell
      title="My performance"
      breadcrumb="Production"
      subtitle="What you finished, how it did at QC, and where you stand against your target — the basis for your incentive."
    >
      <div className="c-stack">
        {tabs.length > 1 && <Tabs tabs={tabs} value={view} onChange={(v) => set({ view: v === 'qc' ? 'qc' : '' })} />}
        <PeriodBar period={period} />
        {isFuture && <Notice tone="info" title="This period has not started">Nothing to count yet.</Notice>}
        {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
        {!data && !error && <EmptyState title="Loading…" />}
        {data && !tabs.length && <EmptyState title="Nothing to show yet" body="Your numbers appear here once you finish laptops on the floor or make QC checks." />}
        {data && view === 'tech' && data.technician && (
          <>
            <Headline title="My jobs" unit="jobs" d={data.technician} />
            <TechnicianJobs data={data.technician} from={from} to={to} />
          </>
        )}
        {data && view === 'qc' && data.qc && (
          <>
            <Headline title="My QC checks" unit="checks" d={data.qc} />
            <QcChecks data={data.qc} from={from} to={to} />
          </>
        )}
      </div>
    </DeskShell>
  );
}
