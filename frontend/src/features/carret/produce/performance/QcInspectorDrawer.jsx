import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DataTable, DateTime, DocNumber, Drawer, EmptyState, Notice, Segmented, StatusChip,
} from '../../../../components/carret';
import { fetchQcInspector } from './perfShared';
import { QcDailyChart, QcLegend } from './qcCharts';

const errMsg = (e) => e?.response?.data?.message || e?.message || 'Could not load';

/** One QC inspector: their days and every check behind the numbers. */
/** One inspector's period: totals, day chart, and every check behind them. */
export function QcChecks({ data, from, to }) {
  const [show, setShow] = useState('all');
  const t = data.totals;
  const checks = (data.checks || []).filter((c) => (
    show === 'all' ? true
      : show === 'missed' ? c.missed
        : show === 'caught' ? c.decision === 'fail'
          : show === 'open' ? c.window_open
            : c.stage === show));
  return (
    <div className="c-stack">
      <div className="c-perf-mini">
        {[
          ['Checks', t.checks, 'blue'], ['QC1', t.qc1, 'blue'], ['QC2', t.qc2, 'blue'], ['Dispatch QC', t.dispatch_qc, 'blue'],
          ['Caught', t.fails_found, 'blue'], ['Missed', t.missed, 'red'], ['Correct', t.correct, 'green'], ['Target', t.target, 'teal'],
        ].map(([k, v, tone]) => <div key={k} className={`t-${tone}`}><span>{k}</span><b>{v}</b></div>)}
      </div>
      <p className="text-ink-3" style={{ margin: 0, fontSize: '13px' }}>
        {data.inspector.daily_target ? `Target ${data.inspector.daily_target}/day${data.inspector.own_target ? ' (own)' : ' (default)'}` : 'No target'} · Correct = checks − missed
      </p>
      {from !== to && (
        <div>
          <QcLegend />
          <QcDailyChart days={data.days} dailyTarget={data.inspector.daily_target} height={200} />
        </div>
      )}
      <Segmented
        label="Show"
        value={show}
        onChange={setShow}
        options={[
          { value: 'all', label: `All (${t.checks})` },
          { value: 'QC1', label: `QC1 (${t.qc1})` },
          { value: 'QC2', label: `QC2 (${t.qc2})` },
          { value: 'Dispatch QC', label: `Dispatch QC (${t.dispatch_qc})` },
          { value: 'caught', label: `Caught (${t.fails_found})` },
          { value: 'missed', label: `Missed (${t.missed})` },
          { value: 'open', label: `Open (${t.open})` },
        ]}
      />
      <DataTable
        rows={checks}
        rowKey={(c, i) => `${c.ticket_id}-${c.stage}-${i}`}
        empty={<EmptyState title="Nothing here" />}
        columns={[
          {
            key: 'l',
            header: 'Laptop',
            render: (c) => <Link to={`/carret/produce/tickets/${c.ticket_id}`} onClick={(e) => e.stopPropagation()}><DocNumber value={c.ttspl_id || `#${c.ticket_id}`} /></Link>,
            sub: (c) => [`Ticket #${c.ticket_id}`, c.sales_order_number].filter(Boolean).join(' · '),
          },
          { key: 's', header: 'Stage', render: (c) => c.stage, sub: (c) => <DateTime value={c.checked_at} /> },
          {
            key: 'd',
            header: 'Decision',
            render: (c) => (c.decision === 'fail'
              ? <StatusChip status="rejected" label="Failed — caught" />
              : c.missed ? <StatusChip status="overdue" label="Passed — missed" />
                : c.window_open ? <StatusChip status="pending" label="Passed — in window" />
                  : <StatusChip status="completed" label="Passed — held up" />),
            sub: (c) => (c.missed ? `${c.missed_how}${c.missed_ref ? ` — ${c.missed_ref}` : ''}` : (c.decision === 'fail' ? c.note || null : null)),
          },
        ]}
      />
    </div>
  );
}

export default function QcInspectorDrawer({ inspector, from, to, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!inspector) return undefined;
    let live = true;
    setData(null); setError('');
    fetchQcInspector(inspector.user_id, { from, to })
      .then(({ data: d }) => { if (live) setData(d.data); })
      .catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [inspector, from, to]);

  return (
    <Drawer open={Boolean(inspector)} onClose={onClose} width="52rem" title={inspector ? `${inspector.name} — QC checks` : ''}>
      {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
      {!data && !error && <EmptyState title="Loading…" />}
      {data && <QcChecks key={inspector?.user_id} data={data} from={from} to={to} />}
    </Drawer>
  );
}
