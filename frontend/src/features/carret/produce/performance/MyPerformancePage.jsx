import React, { useEffect, useState } from 'react';
import DeskShell from '../../../../shells/DeskShell';
import { EmptyState, Notice } from '../../../../components/carret';
import api from '../../../../utils/api';
import PeriodBar, { usePeriodParams } from './PeriodBar';
import { TargetMeter } from './perfShared';
import { StandingPills } from './perfUi';
import { TechnicianJobs } from './TechnicianDrawer';
import { QcChecks } from './QcInspectorDrawer';

/**
 * Production → My performance (migration 427): a floor technician's or QC
 * inspector's own numbers — the same figures their manager sees on Floor
 * performance, for the signed-in person only (GET /api/my-performance never
 * takes a user id). The list behind each number shows why a laptop failed QC,
 * so the page is also where to learn from it.
 */
function Headline({ unit, d }) {
  const t = d.totals;
  const target = t.target;
  const failed = unit === 'jobs' ? t.failed : t.missed;
  const pending = unit === 'jobs' ? t.awaiting : t.open;
  return (
    <section className="c-pf-card c-my-hero">
      <div className="c-my-big"><b>{t.correct}</b>{target ? <span> / {target}</span> : null}</div>
      <div className="c-my-hero-m">
        <div className="c-my-hero-l">Correct {unit} {target ? 'vs target' : '· no target set'}</div>
        {target > 0 && <TargetMeter correct={t.correct} failed={failed} awaiting={pending} target={target} />}
        <div className="flex flex-wrap items-center" style={{ gap: '6px 12px' }}>
          <StandingPills standing={d.standing} eligible={d.eligible} provisional={pending > 0} />
          <span className="text-ink-3" style={{ fontSize: '12.5px' }}>
            {unit === 'jobs' ? 'Correct = jobs − QC failed' : 'Correct = checks − missed'}
          </span>
        </div>
      </div>
    </section>
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
      subtitle="Your work, QC result and incentive against target."
    >
      <div className="c-stack">
        <div className="c-pf-toolbar">
          {tabs.length > 1 ? (
            <div className="c-pf-switch" role="tablist" aria-label="Show">
              {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={view === t.key} className={view === t.key ? 'is-on' : ''} onClick={() => set({ view: t.key === 'qc' ? 'qc' : '' })}>{t.label}</button>
              ))}
            </div>
          ) : <span />}
          <PeriodBar period={period} />
        </div>
        {isFuture && <Notice tone="info" title="This period has not started">Nothing to count yet.</Notice>}
        {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
        {!data && !error && <EmptyState title="Loading…" />}
        {data && !tabs.length && <EmptyState title="Nothing to show yet" />}
        {data && view === 'tech' && data.technician && (
          <>
            <Headline unit="jobs" d={data.technician} />
            <TechnicianJobs data={data.technician} from={from} to={to} page />
          </>
        )}
        {data && view === 'qc' && data.qc && (
          <>
            <Headline unit="checks" d={data.qc} />
            <QcChecks data={data.qc} from={from} to={to} page />
          </>
        )}
      </div>
    </DeskShell>
  );
}
