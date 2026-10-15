import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Clock3, Gauge, Target, Wrench, XCircle,
} from 'lucide-react';
import {
  DataTable, DateTime, DocNumber, Drawer, EmptyState, Notice, Segmented,
} from '../../../../components/carret';
import {
  COLOUR, DailyChart, Legend, QcChip, fetchTechnician,
} from './perfShared';
import { Card, KpiCard } from './perfUi';

const errMsg = (e) => e?.response?.data?.message || e?.message || 'Could not load';

/**
 * One technician's period: totals, day chart, and every laptop behind them.
 * `page` (My performance) lays it out as cards; the drawer keeps it compact.
 */
export function TechnicianJobs({ data, from, to, page = false }) {
  const [show, setShow] = useState('all');
  const t = data.totals;
  const jobs = (data.jobs || []).filter((j) => (show === 'all' ? true : show === 'rework' ? j.rework : !j.rework && j.qc === show));
  const multiDay = from !== to;
  const filters = (
    <Segmented
      label="Show"
      value={show}
      onChange={setShow}
      options={[
        { value: 'all', label: `All (${data.jobs.length})` },
        { value: 'passed', label: `QC passed (${t.passed})` },
        { value: 'failed', label: `QC failed (${t.failed})` },
        { value: 'awaiting', label: `Awaiting (${t.awaiting})` },
        { value: 'rework', label: `Reworks (${t.reworks})` },
      ]}
    />
  );
  const table = (
    <DataTable
      rows={jobs}
      rowKey={(j) => `${j.ticket_id}-${j.attempt}`}
      empty={<EmptyState title="Nothing here" />}
      columns={[
        {
          key: 'l',
          header: 'Laptop',
          render: (j) => <Link to={`/carret/produce/tickets/${j.ticket_id}`} onClick={(e) => e.stopPropagation()}><DocNumber value={j.ttspl_id || `#${j.ticket_id}`} /></Link>,
          sub: (j) => [`Ticket #${j.ticket_id}`, j.sales_order_number, j.rework ? `rework (attempt ${j.attempt})` : null].filter(Boolean).join(' · '),
        },
        { key: 'd', header: 'Final Testing done', render: (j) => <DateTime value={j.done_at} /> },
        {
          key: 'q',
          header: 'QC',
          render: (j) => <QcChip qc={j.qc} sub={j.qc === 'failed' ? j.failed_at_stage : j.qc === 'awaiting' ? j.awaiting_what : null} />,
          sub: (j) => (j.qc === 'failed' ? j.fail_reason || null : (j.qc === 'awaiting' && j.stage_now ? `Now at ${j.stage_now}` : null)),
        },
      ]}
    />
  );
  if (page) {
    const daily = data.technician.daily_target;
    return (
      <>
        <div className="c-pf-kpis">
          <KpiCard tone="blue" icon={Wrench} label="Jobs done" value={t.completed} sub={t.reworks ? `+${t.reworks} reworks (not counted)` : 'Final Testing done'} />
          <KpiCard tone="green" icon={CheckCircle2} label="QC passed" value={t.passed} sub="First time" />
          <KpiCard tone="red" icon={XCircle} label="QC failed" value={t.failed} sub={t.completed ? `${Math.round((t.failed / t.completed) * 100)}% of jobs` : '—'} />
          <KpiCard tone="amber" icon={Clock3} label="Awaiting QC" value={t.awaiting} sub={t.awaiting ? 'May still change' : 'All judged'} />
          <KpiCard tone="violet" icon={Gauge} label="Pass rate" value={t.first_time_pass_rate == null ? '—' : `${t.first_time_pass_rate}%`} sub="First time at QC" />
          <KpiCard tone="teal" icon={Target} label="Target" value={t.target} sub={daily ? `${daily} a day` : 'Not set'} />
        </div>
        {multiDay && (
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
            <DailyChart days={data.days} dailyTarget={daily} height={220} />
          </Card>
        )}
        <Card title="My laptops" count={data.jobs.length} right={filters}>
          {table}
        </Card>
      </>
    );
  }
  return (
    <div className="c-stack">
      <div className="c-perf-mini">
        {[
          ['Jobs done', t.completed, 'blue'],
          ['QC passed', t.passed, 'green'],
          ['QC failed', t.failed, 'red'],
          ['Awaiting QC', t.awaiting, 'amber'],
          ['Correct', t.correct, 'green'],
          ['Target', t.target, 'teal'],
          ['Reworks', t.reworks, 'violet'],
        ].map(([k, v, tone]) => <div key={k} className={`t-${tone}`}><span>{k}</span><b>{v}</b></div>)}
      </div>
      <p className="text-ink-3" style={{ margin: 0, fontSize: '13px' }}>
        Target {data.technician.daily_target}/day{data.technician.own_target ? ' (own)' : ' (default)'} · Correct = jobs − QC failed
      </p>

      {multiDay && (
        <div>
          <Legend />
          <DailyChart days={data.days} dailyTarget={data.technician.daily_target} height={200} />
        </div>
      )}

      {filters}
      {table}
    </div>
  );
}

export default function TechnicianDrawer({ tech, from, to, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!tech) return undefined;
    let live = true;
    setData(null); setError('');
    fetchTechnician(tech.user_id, { from, to })
      .then(({ data: d }) => { if (live) setData(d.data); })
      .catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [tech, from, to]);

  return (
    <Drawer open={Boolean(tech)} onClose={onClose} width="52rem" title={tech ? `${tech.name} — jobs` : ''}>
      {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
      {!data && !error && <EmptyState title="Loading…" />}
      {data && <TechnicianJobs key={tech?.user_id} data={data} from={from} to={to} />}
    </Drawer>
  );
}
