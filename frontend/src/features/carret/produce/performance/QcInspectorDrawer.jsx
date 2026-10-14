import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DataTable, DateTime, DocNumber, Drawer, EmptyState, Notice, Segmented, StatusChip,
} from '../../../../components/carret';
import { fetchQcInspector } from './perfShared';
import { QcDailyChart, QcLegend } from './qcCharts';

const errMsg = (e) => e?.response?.data?.message || e?.message || 'Could not load';

/** One QC inspector: their days and every check behind the numbers. */
export default function QcInspectorDrawer({ inspector, from, to, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [show, setShow] = useState('all');

  useEffect(() => {
    if (!inspector) return undefined;
    let live = true;
    setData(null); setError(''); setShow('all');
    fetchQcInspector(inspector.user_id, { from, to })
      .then(({ data: d }) => { if (live) setData(d.data); })
      .catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [inspector, from, to]);

  const t = data?.totals;
  const checks = (data?.checks || []).filter((c) => (
    show === 'all' ? true
      : show === 'missed' ? c.missed
        : show === 'caught' ? c.decision === 'fail'
          : show === 'open' ? c.window_open
            : c.stage === show));

  return (
    <Drawer open={Boolean(inspector)} onClose={onClose} width="52rem" title={inspector ? `${inspector.name} — QC checks` : ''}>
      {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
      {!data && !error && <EmptyState title="Loading…" />}
      {data && (
        <div className="c-stack">
          <div className="c-perf-mini">
            {[
              ['Checks', t.checks], ['QC1', t.qc1], ['QC2', t.qc2], ['Dispatch QC', t.dispatch_qc],
              ['Caught', t.fails_found], ['Missed', t.missed], ['Correct', t.correct], ['Target', t.target],
            ].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          </div>
          <p className="text-ink-3" style={{ margin: 0, fontSize: '13px' }}>
            {data.inspector.daily_target ? `Target ${data.inspector.daily_target} checks a day${data.inspector.own_target ? ' (their own)' : ' (default)'}.` : 'No target — QC is not their role; a manager can set one.'}
            {' '}Correct = checks − missed{t.open ? `; ${t.open} passes are still in their window, so this can still drop` : ''}.
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
      )}
    </Drawer>
  );
}
