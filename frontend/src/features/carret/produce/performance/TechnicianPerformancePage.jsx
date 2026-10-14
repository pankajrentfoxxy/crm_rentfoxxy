import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, Checkbox, DataTable, EmptyState, Input, Notice, Section, Segmented, StatTile,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  DailyChart, Legend, PERIODS, Standing, TargetMeter, fetchPerformance, istToday, periodRange, periodTitle, stepAnchor,
} from './perfShared';
import TechnicianDrawer from './TechnicianDrawer';
import TargetsDrawer from './TargetsDrawer';

/**
 * Production → Technician performance (migration 415).
 *
 * For managers and floor managers: how many laptops each floor technician
 * finished (Diagnosis → Assembly → Final Testing), how many of those then
 * passed or failed QC, and whether their correct jobs reach the target — the
 * basis for the incentive. Day / week / month (or any range), every number
 * clickable down to the laptops behind it. Definitions live in
 * services/technicianPerformanceService and are spelled out on the page.
 */
const SORTS = {
  correct: (a, b) => b.correct - a.correct,
  completed: (a, b) => b.completed - a.completed,
  failed: (a, b) => b.failed - a.failed,
  vs_target: (a, b) => (b.vs_target ?? -1e9) - (a.vs_target ?? -1e9),
  pass_rate: (a, b) => (b.first_time_pass_rate ?? -1) - (a.first_time_pass_rate ?? -1),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
};

export default function TechnicianPerformancePage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('technician_performance', 'edit');
  const [params, setParams] = useSearchParams();
  const kind = PERIODS.some((p) => p.value === params.get('period')) ? params.get('period') : 'day';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : istToday();
  const custom = { from: params.get('from') || anchor, to: params.get('to') || anchor };
  const { from, to } = kind === 'custom' ? custom : periodRange(kind, anchor);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('correct');
  const [hideIdle, setHideIdle] = useState(true);
  const [open, setOpen] = useState(null);
  const [targetsOpen, setTargetsOpen] = useState(false);

  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    setData(null);
    fetchPerformance({ from, to })
      .then(({ data: d }) => { setData(d.data); setError(''); })
      .catch((e) => setError(e?.response?.data?.message || 'Could not load technician performance'));
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const list = (data?.technicians || []).filter((t) => !hideIdle || t.completed || t.reworks || t.diagnosis || t.assembly);
    return [...list].sort(SORTS[sort]);
  }, [data, sort, hideIdle]);

  const team = data?.team;
  const teamDailyTarget = team?.daily_target || 0;
  const isFuture = from > istToday();
  const failPct = team && team.completed ? Math.round((team.failed / team.completed) * 100) : null;

  const sortHeader = (key, label) => (
    <button type="button" className={`c-th-sort${sort === key ? ' is-on' : ''}`} onClick={(e) => { e.stopPropagation(); setSort(key); }} aria-pressed={sort === key}>
      {label}{sort === key ? ' ▾' : ''}
    </button>
  );

  // Most important first (they stay in view on a phone): who, correct, against target.
  const columns = [
    {
      key: 'n',
      header: sortHeader('name', 'Technician'),
      width: '12rem',
      render: (t) => <span style={{ whiteSpace: 'nowrap' }}>{t.name}</span>,
      sub: (t) => `Target ${t.daily_target}/day${t.own_target ? ' (own)' : ''}`,
    },
    { key: 'k', header: sortHeader('correct', 'Correct'), numeric: true, render: (t) => <b>{t.correct}</b>, sub: (t) => `of ${t.target}` },
    {
      key: 'v',
      header: sortHeader('vs_target', 'Against target'),
      render: (t) => (
        <div style={{ minWidth: '12rem' }}>
          <TargetMeter correct={t.correct} failed={t.failed} awaiting={t.awaiting} target={t.target} />
          <Standing s={t.standing} eligible={t.eligible} provisional={t.provisional} />
        </div>
      ),
    },
    { key: 'c', header: sortHeader('completed', 'Jobs done'), numeric: true, render: (t) => t.completed, sub: (t) => (t.reworks ? `+${t.reworks} rework` : null) },
    { key: 'f', header: sortHeader('failed', 'QC failed'), numeric: true, render: (t) => (t.failed ? <b style={{ color: 'var(--alert-crit)' }}>{t.failed}</b> : 0) },
    { key: 'p', header: 'QC passed', numeric: true, render: (t) => t.passed },
    { key: 'a', header: 'Awaiting QC', numeric: true, render: (t) => t.awaiting },
    { key: 'r', header: sortHeader('pass_rate', 'First-time pass'), numeric: true, render: (t) => (t.first_time_pass_rate == null ? '—' : `${t.first_time_pass_rate}%`) },
    { key: 'dx', header: 'Diagnosis', numeric: true, render: (t) => t.diagnosis },
    { key: 'as', header: 'Assembly', numeric: true, render: (t) => t.assembly },
  ];

  return (
    <DeskShell
      title="Technician performance"
      breadcrumb="Production"
      subtitle="Laptops finished by each floor technician, how many passed QC, and the result against target — for the incentive."
      actions={canEdit && <Button onClick={() => setTargetsOpen(true)}>Daily targets</Button>}
    >
      <div className="c-stack">
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

        {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
        {isFuture && <Notice tone="info" title="This period has not started">Nothing to count yet.</Notice>}
        {!data && !error && <EmptyState title="Loading…" />}

        {data && (
          <>
            <div className="c-perf-tiles">
              <StatTile label="Jobs done" value={team.completed} delta={team.reworks ? `+${team.reworks} reworks (not counted)` : 'Final Testing finished'} />
              <StatTile label="Correct jobs" value={`${team.correct}`} unit={`/ ${team.target} target`} delta={team.target ? `${Math.round((team.correct / team.target) * 100)}% of the team target` : 'No target'} />
              <StatTile label="QC failed" value={team.failed} delta={failPct == null ? '—' : `${failPct}% of jobs`} />
              <StatTile label="Awaiting QC" value={team.awaiting} delta={team.awaiting ? 'Figures can still drop' : 'All jobs judged'} />
              <StatTile label="First-time QC pass" value={team.first_time_pass_rate == null ? '—' : `${team.first_time_pass_rate}%`} delta="of jobs QC has judged" />
              <StatTile label="At or above target" value={`${team.eligible}`} unit={`of ${team.technicians}`} delta="technicians who worked, earning the incentive" />
            </div>

            <details className="c-perf-how">
              <summary>How these numbers are counted</summary>
              <ul>
                <li><b>Job</b> — {data.definitions.job} Credited to the technician the laptop was assigned to.</li>
                <li><b>QC result</b> — failed if the laptop then failed QC1, QC2 or Dispatch QC; passed once it went through QC2 into stock (or through Dispatch QC); otherwise awaiting QC.</li>
                <li><b>Correct</b> — {data.definitions.correct} Awaiting jobs count as correct until QC says otherwise.</li>
                <li><b>Rework</b> — {data.definitions.rework}</li>
                <li><b>Target</b> — {data.definitions.target} This period: {data.period.workingDays} working day{data.period.workingDays === 1 ? '' : 's'}.</li>
                <li><b>Incentive</b> — earned when correct jobs reach the target. Example: target 10, finished 14, 4 failed QC → 10 correct → on target.</li>
              </ul>
            </details>

            {from !== to && (
              <Section title="Team, day by day">
                <Legend />
                <DailyChart days={data.days} dailyTarget={teamDailyTarget} />
              </Section>
            )}

            <Section
              title={`Technicians · ${rows.length}`}
              actions={<Checkbox label="Hide technicians with no work" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} />}
            >
              <p className="text-ink-3" style={{ margin: '0 0 8px', fontSize: '13px' }}>Click a technician to see every laptop behind their numbers. Click a column title to sort.</p>
              <DataTable
                rows={rows}
                rowKey={(t) => t.user_id}
                onRowClick={(t) => setOpen(t)}
                columns={columns}
                empty={<EmptyState title="No floor work in this period" body={isFuture ? undefined : 'Try another day, or untick "Hide technicians with no work".'} />}
              />
            </Section>
          </>
        )}
      </div>

      <TechnicianDrawer tech={open} from={from} to={to} onClose={() => setOpen(null)} />
      {canEdit && (
        <TargetsDrawer
          open={targetsOpen}
          technicians={(data?.technicians || []).filter((t) => t.active)}
          onClose={() => setTargetsOpen(false)}
          onSaved={() => { setTargetsOpen(false); load(); }}
        />
      )}
    </DeskShell>
  );
}
