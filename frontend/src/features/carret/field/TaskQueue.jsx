import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../../components/carret';
import { TASK_KIND_COLOR, fetchFieldTasks, fmtDay, fmtHm } from './fieldApi';

/**
 * One task at a time, in the lead's order (migration 439).
 *
 * useFieldTasks(): the technician's tasks; allowed(key) says whether a card may
 * be shown and worked now — the current task, or something being carried back.
 * TaskQueue: the task to do now (in full) and what is up next today (names
 * only), then tomorrow's and later tasks — shown, not opened (migration 440).
 * A visit waiting for its part can be opened to see where the part is.
 */
export function useFieldTasks() {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    fetchFieldTasks().then(({ data: d }) => setData(d)).catch(() => setData({ failed: true }));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const allowed = (key) => {
    if (!data || data.failed || !data.is_field_user) return true;
    const t = (data.tasks || []).find((x) => x.key === key);
    if (!t) return true;
    return t.state === 'carrying' || t.state === 'waiting' || data.current?.key === key;
  };
  return { data, reload: load, allowed };
}

const KIND = { visit: 'Visit', pickup: 'Pickup', return: 'Return pickup', delivery: 'Delivery', vendor: 'Vendor' };

export default function TaskQueue({ data, here }) {
  const navigate = useNavigate();
  const loc = useLocation();
  if (!data || data.failed || !data.is_field_user) return null;
  const tasks = data.tasks || [];
  const cur = data.current;
  const next = tasks.filter((t) => t.state === 'pending' && t.bucket === 'today' && t.key !== cur?.key);
  const ahead = tasks.filter((t) => t.state === 'pending' && t.bucket !== 'today');
  const waiting = tasks.filter((t) => t.state === 'waiting');
  const carrying = tasks.filter((t) => t.state === 'carrying');
  if (!cur && !carrying.length && !ahead.length && !waiting.length) return null;
  const onThisPage = cur && (here === 'work' ? !cur.key.startsWith('dc:') : cur.key.startsWith('dc:'));
  return (
    <div className="c-tq">
      {cur && (
        <div className={`c-tq-now${cur.state === 'active' ? ' is-active' : ''}`} style={{ '--k': TASK_KIND_COLOR[cur.kind] || '#2563eb' }}>
          <div className="c-tq-k">{cur.state === 'active' ? 'In progress — finish it before anything else' : (data.has_order ? 'Your next task (set by your lead)' : 'Your next task')}{cur.time ? ` · ${fmtHm(cur.time)}` : ''}</div>
          <div className="c-tq-t"><span className="c-tq-chip">{KIND[cur.kind] || cur.kind}</span><b>{cur.customer || cur.title}</b></div>
          <div className="c-tq-s">{cur.title}{cur.address ? ` · ${cur.address}` : ''}</div>
          {cur.step && <div className="c-tq-step">Next step: {cur.step}</div>}
          {/* A My deliveries card works in place; anything else opens its own screen. */}
          {!(onThisPage && here === 'deliveries') && cur.link !== loc.pathname && <Button variant="primary" onClick={() => navigate(cur.link)}>Open it ›</Button>}
        </div>
      )}
      {!cur && (ahead.length > 0 || waiting.length > 0) && (
        <div className="c-tq-now is-idle"><div className="c-tq-k">Nothing more for today</div></div>
      )}
      {next.length > 0 && (
        <div className="c-tq-next">
          <div className="c-tq-k">Up next today · {next.length}</div>
          <ol>
            {next.slice(0, 12).map((t, i) => (
              <li key={t.key} style={{ '--k': TASK_KIND_COLOR[t.kind] || '#64748b' }}>
                <span className="c-tq-n">{i + 2}</span>
                <span className="c-tq-chip">{KIND[t.kind] || t.kind}</span>
                <span className="c-tq-c">{t.customer || t.title}</span>
                {t.time && <span className="c-tq-time">{fmtHm(t.time)}</span>}
              </li>
            ))}
          </ol>
          <small className="text-ink-3">Opens one at a time — after the task above is done.</small>
        </div>
      )}
      {waiting.length > 0 && (
        <div className="c-tq-carry is-wait">
          <div className="c-tq-k">Waiting for a part · {waiting.length}</div>
          <div className="c-tq-carry-l">{waiting.map((t) => <span key={t.key}>{t.customer || t.title}</span>)}</div>
          <small className="text-ink-3">Not holding you up — it comes back to your list when the part is with you.</small>
        </div>
      )}
      {ahead.length > 0 && (
        <div className="c-tq-next is-ahead">
          <div className="c-tq-k">Tomorrow and later · {ahead.length}</div>
          <ol>
            {ahead.slice(0, 20).map((t) => (
              <li key={t.key} style={{ '--k': TASK_KIND_COLOR[t.kind] || '#64748b' }}>
                <span className="c-tq-d">{fmtDay(t.date)}{t.time ? ` · ${fmtHm(t.time)}` : ''}</span>
                <span className="c-tq-chip">{KIND[t.kind] || t.kind}</span>
                <span className="c-tq-c">{t.customer || t.title}</span>
              </li>
            ))}
          </ol>
          <small className="text-ink-3">Planned by your lead — they open on their day.</small>
        </div>
      )}
      {carrying.length > 0 && (
        <div className="c-tq-carry">
          <div className="c-tq-k">With you — hand in at the warehouse gate</div>
          <div className="c-tq-carry-l">{carrying.map((t) => <span key={t.key}>{t.title}</span>)}</div>
        </div>
      )}
    </div>
  );
}
