import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Checkbox, DataTable, EmptyState, Notice, Section, StatTile,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  Standing, TargetMeter, fetchQcPerformance, fetchQcTargets, saveQcTargets, targetText,
} from './perfShared';
import { QcDailyChart, QcLegend } from './qcCharts';
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

  const columns = [
    { key: 'n', header: sortHeader('name', 'Inspector'), width: '12rem', render: (t) => <span style={{ whiteSpace: 'nowrap' }}>{t.name}</span>, sub: (t) => targetText(t) },
    { key: 'k', header: sortHeader('correct', 'Correct'), numeric: true, render: (t) => <b>{t.correct}</b>, sub: (t) => (t.target ? `of ${t.target}` : null) },
    {
      key: 'v',
      header: sortHeader('vs_target', 'Against target'),
      render: (t) => (
        <div style={{ minWidth: '12rem' }}>
          <TargetMeter correct={t.correct} failed={t.missed} awaiting={t.open} target={t.target} />
          <Standing s={t.standing} eligible={t.eligible} provisional={t.provisional} />
        </div>
      ),
    },
    { key: 'c', header: sortHeader('checks', 'Checks'), numeric: true, render: (t) => t.checks },
    { key: 'q1', header: 'QC1', numeric: true, render: (t) => t.qc1 },
    { key: 'q2', header: 'QC2', numeric: true, render: (t) => t.qc2 },
    { key: 'dq', header: 'Dispatch QC', numeric: true, render: (t) => t.dispatch_qc },
    { key: 'f', header: 'Defects caught', numeric: true, render: (t) => t.fails_found },
    { key: 'm', header: sortHeader('missed', 'Missed'), numeric: true, render: (t) => (t.missed ? <b style={{ color: 'var(--alert-crit)' }}>{t.missed}</b> : 0), sub: (t) => (t.open ? `${t.open} still open` : null) },
    { key: 'a', header: sortHeader('accuracy', 'Pass accuracy'), numeric: true, render: (t) => (t.accuracy == null ? '—' : `${t.accuracy}%`) },
  ];

  return (
    <>
      <div className="c-stack">
        {canEdit && <div className="flex" style={{ justifyContent: 'flex-end' }}><Button onClick={() => setTargetsOpen(true)}>QC daily targets</Button></div>}
        {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
        {!data && !error && <EmptyState title="Loading…" />}
        {data && (
          <>
            <div className="c-perf-tiles">
              <StatTile label="QC checks" value={team.checks} delta={`QC1 ${team.qc1} · QC2 ${team.qc2} · Dispatch QC ${team.dispatch_qc}`} />
              <StatTile label="Correct checks" value={`${team.correct}`} unit={`/ ${team.target} target`} delta={team.target ? `${Math.round((team.correct / team.target) * 100)}% of the team target` : 'No target'} />
              <StatTile label="Defects caught" value={team.fails_found} delta="laptops failed at QC" />
              <StatTile label="Missed" value={team.missed} delta={team.open ? `${team.open} passes still in their window` : 'All passes judged'} />
              <StatTile label="Pass accuracy" value={team.accuracy == null ? '—' : `${team.accuracy}%`} delta="passes that held up" />
              <StatTile label="At or above target" value={`${team.eligible}`} unit={`of ${team.with_target}`} delta="inspectors with a target, earning the incentive" />
            </div>

            <details className="c-perf-how">
              <summary>How these numbers are counted</summary>
              <ul>
                <li><b>Check</b> — {data.definitions.check}</li>
                <li><b>Missed</b> — {data.definitions.missed}</li>
                <li><b>Correct</b> — {data.definitions.correct}</li>
                <li><b>Target</b> — {data.definitions.target} This period: {data.period.workingDays} working day{data.period.workingDays === 1 ? '' : 's'}.</li>
                <li><b>Incentive</b> — earned when correct checks reach the target. Example: target 25 a day, 30 checks, 2 missed → 28 correct → above target.</li>
              </ul>
            </details>

            {from !== to && (
              <Section title="QC team, day by day">
                <QcLegend />
                <QcDailyChart days={data.days} dailyTarget={team.daily_target} />
              </Section>
            )}

            <Section
              title={`Inspectors · ${rows.length}`}
              actions={<Checkbox label="Hide people with no checks" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} />}
            >
              <p className="text-ink-3" style={{ margin: '0 0 8px', fontSize: '13px' }}>Click an inspector to see every check behind their numbers. Click a column title to sort.</p>
              <DataTable
                rows={rows}
                rowKey={(t) => t.user_id}
                onRowClick={(t) => setOpen(t)}
                columns={columns}
                empty={<EmptyState title="No QC checks in this period" body={isFuture ? undefined : 'Try another day, or untick "Hide people with no checks".'} />}
              />
            </Section>
          </>
        )}
      </div>

      <QcInspectorDrawer inspector={open} from={from} to={to} onClose={() => setOpen(null)} />
      {canEdit && (
        <TargetsDrawer
          open={targetsOpen}
          technicians={(data?.inspectors || []).filter((t) => t.active)}
          fetch={fetchQcTargets}
          save={saveQcTargets}
          title="QC daily targets"
          unitText="QC checks (QC1, QC2 and Dispatch QC together) each inspector should make per working day, Monday to Saturday."
          defaultHint="Applies to QC inspectors. Anyone else (a floor manager who steps in) has a target only if you set one below."
          onClose={() => setTargetsOpen(false)}
          onSaved={() => { setTargetsOpen(false); load(); }}
        />
      )}
    </>
  );
}
