import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, Gauge, Info, ShieldCheck, Trophy,
} from 'lucide-react';
import {
  Button, Checkbox, DataTable, EmptyState, Notice,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { fetchQcPerformance, fetchQcTargets, saveQcTargets } from './perfShared';
import { QcDailyChart, QC_COLOUR } from './qcCharts';
import {
  Card, HowDrawer, KpiCard, Num, TargetCell, Who,
} from './perfUi';
import QcInspectorDrawer from './QcInspectorDrawer';
import TargetsDrawer from './TargetsDrawer';

/**
 * Floor performance → QC inspectors (migration 423). Checks made at QC1, QC2
 * and Dispatch QC — people rotate, so one person's checks span all three —
 * how many passes later proved wrong ("missed"), and correct checks against
 * target for the incentive. Definitions: services/qcPerformanceService.
 */
const SORTS = {
  correct: (a, b) => b.correct - a.correct,
  checks: (a, b) => b.checks - a.checks,
  missed: (a, b) => b.missed - a.missed,
  vs_target: (a, b) => (b.vs_target ?? -1e9) - (a.vs_target ?? -1e9),
  accuracy: (a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
};

export default function QcInspectorsView({ from, to, isFuture }) {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('qc_performance', 'edit');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('correct');
  const [hideIdle, setHideIdle] = useState(true);
  const [open, setOpen] = useState(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  const load = useCallback(() => {
    setData(null);
    fetchQcPerformance({ from, to })
      .then(({ data: d }) => { setData(d.data); setError(''); })
      .catch((e) => setError(e?.response?.data?.message || 'Could not load QC performance'));
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const list = (data?.inspectors || []).filter((t) => !hideIdle || t.checks);
    return [...list].sort(SORTS[sort]);
  }, [data, sort, hideIdle]);

  const team = data?.team;
  const sortHeader = (key, label) => (
    <button type="button" className={`c-th-sort${sort === key ? ' is-on' : ''}`} onClick={(e) => { e.stopPropagation(); setSort(key); }} aria-pressed={sort === key}>
      {label}{sort === key ? ' ▾' : ''}
    </button>
  );

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const columns = [
    { key: 'n', header: sortHeader('name', 'Inspector'), render: (t) => <Who id={t.user_id} name={t.name} sub={t.daily_target ? `${t.daily_target}/day${t.own_target ? ' · own' : ''}` : 'No target'} /> },
    {
      key: 'v',
      header: sortHeader('vs_target', 'Correct vs target'),
      render: (t) => <TargetCell correct={t.correct} target={t.target} bad={t.missed} pending={t.open} standing={t.standing} eligible={t.eligible} provisional={t.provisional} />,
    },
    { key: 'c', header: sortHeader('checks', 'Checks'), numeric: true, render: (t) => <Num value={t.checks} tone="blue" /> },
    { key: 'q1', header: 'QC1', numeric: true, render: (t) => <Num value={t.qc1} /> },
    { key: 'q2', header: 'QC2', numeric: true, render: (t) => <Num value={t.qc2} /> },
    { key: 'dq', header: 'Dispatch', numeric: true, render: (t) => <Num value={t.dispatch_qc} /> },
    { key: 'f', header: 'Caught', numeric: true, render: (t) => <Num value={t.fails_found} tone="blue" /> },
    { key: 'm', header: sortHeader('missed', 'Missed'), numeric: true, render: (t) => <Num value={t.missed} tone="red" />, sub: (t) => (t.open ? `${t.open} open` : null) },
    { key: 'a', header: sortHeader('accuracy', 'Accuracy'), numeric: true, render: (t) => (t.accuracy == null ? <span className="c-pf-num is-zero">—</span> : <span className="c-pf-num t-violet">{t.accuracy}%</span>) },
  ];

  return (
    <>
      <div className="c-stack">
        {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
        {!data && !error && <EmptyState title="Loading…" />}
        {data && (
          <>
            <div className="c-pf-kpis">
              <KpiCard tone="blue" icon={ClipboardCheck} label="QC checks" value={team.checks} sub={`QC1 ${team.qc1} · QC2 ${team.qc2} · DQC ${team.dispatch_qc}`} />
              <KpiCard tone="green" icon={CheckCircle2} label="Correct" value={team.correct} unit={team.target ? `/ ${team.target}` : null} progress={team.target ? pct(team.correct, team.target) : null} sub={team.target ? `${pct(team.correct, team.target)}% of target` : 'No target'} />
              <KpiCard tone="blue" icon={ShieldCheck} label="Defects caught" value={team.fails_found} sub="Failed at QC" />
              <KpiCard tone="red" icon={AlertTriangle} label="Missed" value={team.missed} sub={team.open ? `${team.open} still open` : 'All judged'} />
              <KpiCard tone="violet" icon={Gauge} label="Accuracy" value={team.accuracy == null ? '—' : `${team.accuracy}%`} sub="Passes that held" />
              <KpiCard tone="teal" icon={Trophy} label="On target" value={team.eligible} unit={`/ ${team.with_target}`} progress={team.with_target ? pct(team.eligible, team.with_target) : null} sub="Earning incentive" />
            </div>

            {from !== to && (
              <Card
                title="Day by day"
                right={(
                  <span className="c-pf-legend">
                    <span><i style={{ background: QC_COLOUR.held }} />Held</span>
                    <span><i style={{ background: QC_COLOUR.open }} />Open</span>
                    <span><i style={{ background: QC_COLOUR.missed }} />Missed</span>
                    <span><i style={{ background: QC_COLOUR.caught }} />Caught</span>
                    <span><i style={{ background: 'transparent', borderTop: `2px dashed ${QC_COLOUR.target}`, height: 0, width: 14 }} />Target</span>
                  </span>
                )}
                bodyPad
              >
                <QcDailyChart days={data.days} dailyTarget={team.daily_target} height={220} />
              </Card>
            )}

            <Card
              title="QC inspectors"
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
                empty={<EmptyState title="No QC checks in this period" body={isFuture ? undefined : 'Try another period, or untick "Hide idle".'} />}
              />
            </Card>
          </>
        )}
      </div>

      <QcInspectorDrawer inspector={open} from={from} to={to} onClose={() => setOpen(null)} />
      <HowDrawer
        open={howOpen}
        onClose={() => setHowOpen(false)}
        items={data ? [
          ['Check', data.definitions.check],
          ['Missed', data.definitions.missed],
          ['Correct', data.definitions.correct],
          ['Target', `${data.definitions.target} This period: ${data.period.workingDays} working day(s).`],
          ['Incentive', 'Earned when correct ≥ target. Example: target 25 a day, 30 checks, 2 missed → 28 correct → above target.'],
        ] : []}
      />
      {canEdit && (
        <TargetsDrawer
          open={targetsOpen}
          technicians={(data?.inspectors || []).filter((t) => t.active)}
          fetch={fetchQcTargets}
          save={saveQcTargets}
          title="QC daily targets"
          unitText="QC checks (QC1, QC2 and Dispatch QC together) per inspector per working day, Monday to Saturday."
          defaultHint="Applies to QC inspectors; anyone else only with their own target."
          onClose={() => setTargetsOpen(false)}
          onSaved={() => { setTargetsOpen(false); load(); }}
        />
      )}
    </>
  );
}
