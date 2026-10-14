import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DataTable, DateTime, DocNumber, Drawer, EmptyState, Notice, Segmented,
} from '../../../../components/carret';
import { DailyChart, Legend, QcChip, fetchTechnician } from './perfShared';

const errMsg = (e) => e?.response?.data?.message || e?.message || 'Could not load';

/** One technician: their days and every laptop behind the numbers. */
export default function TechnicianDrawer({ tech, from, to, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [show, setShow] = useState('all');

  useEffect(() => {
    if (!tech) return undefined;
    let live = true;
    setData(null); setError(''); setShow('all');
    fetchTechnician(tech.user_id, { from, to })
      .then(({ data: d }) => { if (live) setData(d.data); })
      .catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [tech, from, to]);

  const t = data?.totals;
  const jobs = (data?.jobs || []).filter((j) => (show === 'all' ? true : show === 'rework' ? j.rework : !j.rework && j.qc === show));
  const multiDay = from !== to;

  return (
    <Drawer open={Boolean(tech)} onClose={onClose} width="52rem" title={tech ? `${tech.name} — jobs` : ''}>
      {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
      {!data && !error && <EmptyState title="Loading…" />}
      {data && (
        <div className="c-stack">
          <div className="c-perf-mini">
            {[
              ['Jobs done', t.completed],
              ['QC passed', t.passed],
              ['QC failed', t.failed],
              ['Awaiting QC', t.awaiting],
              ['Correct', t.correct],
              ['Target', t.target],
              ['Reworks', t.reworks],
            ].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          </div>
          <p className="text-ink-3" style={{ margin: 0, fontSize: '13px' }}>
            Target {data.technician.daily_target} a day{data.technician.own_target ? ' (their own)' : ' (default)'}.
            Correct = jobs − QC failed{t.awaiting ? `; ${t.awaiting} still awaiting QC, so this can still drop` : ''}.
          </p>

          {multiDay && (
            <div>
              <Legend />
              <DailyChart days={data.days} dailyTarget={data.technician.daily_target} height={200} />
            </div>
          )}

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
        </div>
      )}
    </Drawer>
  );
}
