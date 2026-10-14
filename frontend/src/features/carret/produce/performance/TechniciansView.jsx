import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Clock3, Gauge, Info, Trophy, Wrench, XCircle,
} from 'lucide-react';
import {
  Button, Checkbox, DataTable, EmptyState, Notice,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { COLOUR, DailyChart, fetchPerformance } from './perfShared';
import {
  Card, HowDrawer, KpiCard, Num, TargetCell, Who,
} from './perfUi';
import TechnicianDrawer from './TechnicianDrawer';
import TargetsDrawer from './TargetsDrawer';

/**
 * Floor performance → Technicians (migration 415). How many laptops each floor
 * technician finished (Diagnosis → Assembly → Final Testing), how many then
 * passed or failed QC, and correct jobs against target — the incentive.
 * Definitions: services/technicianPerformanceService.
 */
const SORTS = {
  correct: (a, b) => b.correct - a.correct,
  completed: (a, b) => b.completed - a.completed,
  failed: (a, b) => b.failed - a.failed,
  vs_target: (a, b) => (b.vs_target ?? -1e9) - (a.vs_target ?? -1e9),
  pass_rate: (a, b) => (b.first_time_pass_rate ?? -1) - (a.first_time_pass_rate ?? -1),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
};

export default function TechniciansView({ from, to, isFuture }) {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('technician_performance', 'edit');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('correct');
  const [hideIdle, setHideIdle] = useState(true);
  const [open, setOpen] = useState(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

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
  const failPct = team && team.completed ? Math.round((team.failed / team.completed) * 100) : null;

  const sortHeader = (key, label) => (
    <button type="button" className={`c-th-sort${sort === key ? ' is-on' : ''}`} onClick={(e) => { e.stopPropagation(); setSort(key); }} aria-pressed={sort === key}>
      {label}{sort === key ? ' ▾' : ''}
    </button>
  );

  const columns = [
    {
      key: 'n',
      header: sortHeader('name', 'Technician'),
      render: (t) => <Who id={t.user_id} name={t.name} sub={t.daily_target ? `${t.daily_target}/day${t.own_target ? ' · own' : ''}` : 'No target'} />,
    },
    {
      key: 'v',
      header: sortHeader('vs_target', 'Correct vs target'),
      render: (t) => <TargetCell correct={t.correct} target={t.target} bad={t.failed} pending={t.awaiting} standing={t.standing} eligible={t.eligible} provisional={t.provisional} />,
    },
    { key: 'c', header: sortHeader('completed', 'Jobs'), numeric: true, render: (t) => <Num value={t.completed} tone="blue" />, sub: (t) => (t.reworks ? `+${t.reworks} rework` : null) },
    { key: 'p', header: 'Passed', numeric: true, render: (t) => <Num value={t.passed} tone="green" /> },
    { key: 'f', header: sortHeader('failed', 'Failed'), numeric: true, render: (t) => <Num value={t.failed} tone="red" /> },
    { key: 'a', header: 'Awaiting', numeric: true, render: (t) => <Num value={t.awaiting} tone="amber" /> },
    { key: 'r', header: sortHeader('pass_rate', 'Pass %'), numeric: true, render: (t) => (t.first_time_pass_rate == null ? <span className="c-pf-num is-zero">—</span> : <span className="c-pf-num t-violet">{t.first_time_pass_rate}%</span>) },
    { key: 'dx', header: 'Diagnosis', numeric: true, render: (t) => <Num value={t.diagnosis} /> },
    { key: 'as', header: 'Assembly', numeric: true, render: (t) => <Num value={t.assembly} /> },
  ];

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <>
      <div className="c-stack">
        {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
        {!data && !error && <EmptyState title="Loading…" />}
        {data && (
          <>
            <div className="c-pf-kpis">
              <KpiCard tone="blue" icon={Wrench} label="Jobs done" value={team.completed} sub={team.reworks ? `+${team.reworks} reworks` : 'Final Testing done'} />
              <KpiCard tone="green" icon={CheckCircle2} label="Correct" value={team.correct} unit={team.target ? `/ ${team.target}` : null} progress={team.target ? pct(team.correct, team.target) : null} sub={team.target ? `${pct(team.correct, team.target)}% of target` : 'No target'} />
              <KpiCard tone="red" icon={XCircle} label="QC failed" value={team.failed} sub={failPct == null ? '—' : `${failPct}% of jobs`} />
              <KpiCard tone="amber" icon={Clock3} label="Awaiting QC" value={team.awaiting} sub={team.awaiting ? 'May still change' : 'All judged'} />
              <KpiCard tone="violet" icon={Gauge} label="Pass rate" value={team.first_time_pass_rate == null ? '—' : `${team.first_time_pass_rate}%`} sub="First time at QC" />
              <KpiCard tone="teal" icon={Trophy} label="On target" value={team.eligible} unit={`/ ${team.with_target}`} progress={team.with_target ? pct(team.eligible, team.with_target) : null} sub="Earning incentive" />
            </div>

            {from !== to && (
              <Card
                title="Day by day"
                right={(
                  <span className="c-pf-legend">
                    <span><i style={{ background: COLOUR.passed }} />Passed</span>
                    <span><i style={{ background: COLOUR.awaiting }} />Awaiting</span>
                    <span><i style={{ background: COLOUR.failed }} />Failed</span>
                    <span><i style={{ background: 'transparent', borderTop: `2px dashed ${COLOUR.target}`, height: 0, width: 14 }} />Target</span>
                  </span>
                )}
                bodyPad
              >
                <DailyChart days={data.days} dailyTarget={teamDailyTarget} height={220} />
              </Card>
            )}

            <Card
              title="Technicians"
              count={rows.length}
              right={(
                <>
                  <Checkbox label="Hide idle" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} />
                  <Button variant="quiet" onClick={() => setHowOpen(true)}><Info size={14} aria-hidden="true" /> How it's counted</Button>
                  {canEdit && <Button onClick={() => setTargetsOpen(true)}>Daily targets</Button>}
                </>
              )}
            >
              <DataTable
                rows={rows}
                rowKey={(t) => t.user_id}
                onRowClick={(t) => setOpen(t)}
                columns={columns}
                empty={<EmptyState title="No floor work in this period" body={isFuture ? undefined : 'Try another period, or untick "Hide idle".'} />}
              />
            </Card>
          </>
        )}
      </div>

      <TechnicianDrawer tech={open} from={from} to={to} onClose={() => setOpen(null)} />
      <HowDrawer
        open={howOpen}
        onClose={() => setHowOpen(false)}
        items={data ? [
          ['Job', `${data.definitions.job} Credited to the technician it was assigned to.`],
          ['Passed / Failed / Awaiting', 'Failed if the laptop then failed QC1, QC2 or Dispatch QC; passed once through QC2 into stock (or Dispatch QC); otherwise awaiting.'],
          ['Correct', `${data.definitions.correct} Awaiting jobs count until QC says otherwise.`],
          ['Rework', data.definitions.rework],
          ['Target', `${data.definitions.target} This period: ${data.period.workingDays} working day(s).`],
          ['Incentive', 'Earned when correct ≥ target. Example: target 10, finished 14, 4 failed QC → 10 correct → on target.'],
        ] : []}
      />
      {canEdit && (
        <TargetsDrawer
          open={targetsOpen}
          technicians={(data?.technicians || []).filter((t) => t.active)}
          onClose={() => setTargetsOpen(false)}
          onSaved={() => { setTargetsOpen(false); load(); }}
        />
      )}
    </>
  );
}
