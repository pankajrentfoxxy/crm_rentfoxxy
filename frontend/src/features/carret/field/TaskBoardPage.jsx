import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import { Button, EmptyState, Input, Notice, Segmented, Select } from '../../../components/carret';
import { assignItem, assignPickup } from '../serve/serveApi';
import {
  TASK_KIND_COLOR, TASK_KIND_LABEL, fetchFieldTasks, fetchTaskBoard, fmtDay, fmtHm, fmtKm, planFieldTask, releaseFieldTask,
  saveFieldTaskPlan,
} from './fieldApi';

/**
 * Support → Task board (17 Oct 2026, migration 440). The lead plans each field
 * technician's work: which task, which day, what time, in what order.
 *
 *   left    technicians — today / tomorrow / later, what is in progress
 *   middle  one technician's plan by day; drag a card (or ↑ ↓) to change the
 *           order or drop it on another day; set a time; "Do next" puts it
 *           straight after what is in progress
 *   right   support jobs nobody holds yet — assign next, at the end of today,
 *           or on a day and time
 *
 * Every change saves at once. The technician starts only today's tasks, one at
 * a time, in this order; tomorrow's and later ones show on My work, not opened.
 */
const errMsg = (e) => e?.response?.data?.message || e?.message || 'That did not work.';
const addDays = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const byDate = (list) => list
  .map((t, i) => [t, i])
  .sort((a, b) => {
    const wa = a[0].state === 'waiting'; const wb = b[0].state === 'waiting';
    if (wa !== wb) return wa ? 1 : -1;
    if (a[0].date !== b[0].date) return a[0].date < b[0].date ? -1 : 1;
    const aa = a[0].state === 'active'; const ab = b[0].state === 'active';
    if (aa !== ab) return aa ? -1 : 1;
    return a[1] - b[1];
  })
  .map(([t]) => t);

function TaskCard({ t, n, today, busy, onDragStart, onDropBefore, onTime, onDay, onNext, onMove, onPutBack, onReassign, techs, techId }) {
  const [over, setOver] = useState(false);
  const [giveTo, setGiveTo] = useState('');
  const fixed = t.state === 'active' || t.state === 'waiting';
  return (
    <li
      className={`c-tb-card${t.state === 'active' ? ' is-active' : ''}${t.state === 'waiting' ? ' is-wait' : ''}${over ? ' is-over' : ''}`}
      style={{ '--k': TASK_KIND_COLOR[t.kind] || '#64748b' }}
      draggable={!fixed && !busy}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.key); onDragStart(t.key); }}
      onDragOver={(e) => { if (t.state !== 'active') { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); onDropBefore(t); }}
    >
      <div className="c-tb-top">
        <span className="c-tb-grip" aria-hidden="true">{fixed ? '' : '⋮⋮'}</span>
        <span className="c-tb-n">{t.state === 'waiting' ? '⚙' : n}</span>
        <span className="c-tq-chip">{TASK_KIND_LABEL[t.kind] || t.kind}</span>
        <b className="c-tb-c">{t.customer || t.title}</b>
        {t.state === 'active' && <span className="c-tb-badge is-red">In progress</span>}
        {t.state === 'waiting' && <span className="c-tb-badge">Waiting for part</span>}
        {t.overdue && t.state === 'pending' && <span className="c-tb-badge is-warn">From an earlier day</span>}
        {t.priority && t.priority !== 'normal' && <span className="c-tb-badge is-warn">{t.priority}</span>}
        {t.sla === 'breached' && <span className="c-tb-badge is-red">SLA late</span>}
      </div>
      <div className="c-tb-body">
        <div>{t.title}{t.ticket_id ? <> · <Link to={`/carret/serve/tickets/${t.ticket_id}`}>Ticket #{t.ticket_id}</Link></> : null}</div>
        {t.laptops?.length > 0 && <div className="font-mono c-tb-lap">{t.laptops.join('  ·  ')}</div>}
        {t.issue && <div>Problem: {t.issue}</div>}
        <div className="text-ink-3">{t.address || 'No address'}{t.phone ? ` · ${t.phone}` : ''}</div>
        {t.appointment && <div className="text-ink-3">Customer slot: {new Date(t.appointment).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</div>}
        {t.step && <div className="text-ink-3">Next step: {t.step}</div>}
      </div>
      {t.state !== 'waiting' && (
        <div className="c-tb-ctl">
          <label className="c-tb-f">
            <span>Time</span>
            <Input type="time" value={t.time || ''} disabled={busy} onChange={(e) => onTime(t, e.target.value)} />
          </label>
          {t.state !== 'active' && (
            <label className="c-tb-f">
              <span>Day</span>
              <Input type="date" min={today} value={t.date || today} disabled={busy} onChange={(e) => e.target.value && onDay(t, e.target.value)} />
            </label>
          )}
          <span className="c-tb-btns">
            {t.state === 'active' ? (
              <Button variant="quiet" disabled={busy} onClick={() => onPutBack(t)} title="Reached by mistake / customer away — back to not started">Put back</Button>
            ) : (
              <>
                <Button variant="quiet" disabled={busy} onClick={() => onNext(t)} title="Straight after what is in progress, today">Do next</Button>
                <Button variant="quiet" disabled={busy} onClick={() => onMove(t, -1)} aria-label="Move up">↑</Button>
                <Button variant="quiet" disabled={busy} onClick={() => onMove(t, 1)} aria-label="Move down">↓</Button>
              </>
            )}
          </span>
        </div>
      )}
      {t.state === 'pending' && t.key.startsWith('item:') && (
        <div className="c-tb-give">
          <Select
            value={giveTo}
            onChange={(e) => setGiveTo(e.target.value)}
            aria-label="Give to another technician"
            options={[{ value: '', label: 'Give to another technician…' }, ...techs.filter((x) => x.user_id !== techId).map((x) => ({ value: String(x.user_id), label: x.name }))]}
          />
          {giveTo && <Button disabled={busy} onClick={() => { onReassign(t, Number(giveTo)); setGiveTo(''); }}>Give</Button>}
        </div>
      )}
    </li>
  );
}

function DayColumn({ title, sub, date, list, startN, today, onDropEnd, ...cardProps }) {
  const [over, setOver] = useState(false);
  return (
    <section
      className={`c-tb-day${over ? ' is-over' : ''}`}
      onDragOver={(e) => { if (date) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (date) onDropEnd(date); }}
    >
      <header className="c-tb-dayh"><b>{title}</b><span>{sub}</span><span className="c-tb-cnt">{list.length}</span></header>
      {list.length ? (
        <ol className="c-tb-list">
          {list.map((t, i) => <TaskCard key={t.key} t={t} n={startN + i} today={today} {...cardProps} />)}
        </ol>
      ) : <div className="c-tb-empty">{date ? 'Nothing planned — drop a task here' : 'None'}</div>}
    </section>
  );
}

function AssignCard({ job, techs, defaultTech, today, busy, onAssign }) {
  const [tech, setTech] = useState(String(defaultTech || ''));
  const [when, setWhen] = useState('next');
  const [date, setDate] = useState(addDays(today, 1));
  const [time, setTime] = useState('');
  useEffect(() => { if (defaultTech) setTech(String(defaultTech)); }, [defaultTech]);
  return (
    <li className="c-tb-card is-un" style={{ '--k': TASK_KIND_COLOR[job.kind] || '#64748b' }}>
      <div className="c-tb-top">
        <span className="c-tq-chip">{TASK_KIND_LABEL[job.kind] || job.kind}</span>
        <b className="c-tb-c">{job.customer}</b>
        {job.priority && job.priority !== 'normal' && <span className="c-tb-badge is-warn">{job.priority}</span>}
      </div>
      <div className="c-tb-body">
        <div>{job.title} · <Link to={`/carret/serve/tickets/${job.ticket_id}`}>Ticket #{job.ticket_id}</Link></div>
        {job.laptops?.length > 0 && <div className="font-mono c-tb-lap">{job.laptops.join('  ·  ')}</div>}
        {job.issue && <div>Problem: {job.issue}</div>}
        <div className="text-ink-3">{job.address || 'No address'}</div>
      </div>
      <div className="c-tb-assign">
        <Select value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Technician" options={[{ value: '', label: 'Choose a technician…' }, ...techs.map((x) => ({ value: String(x.user_id), label: `${x.name} · ${x.today} today` }))]} />
        <Segmented
          value={when}
          onChange={setWhen}
          label="When"
          options={[{ value: 'next', label: 'Do next' }, { value: 'end', label: 'Today, last' }, { value: 'day', label: 'On a day' }]}
        />
        {when === 'day' && (
          <div className="flex" style={{ gap: '8px' }}>
            <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
          </div>
        )}
        {when !== 'day' && (
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time (optional)" />
        )}
        <Button variant="primary" disabled={busy || !tech} onClick={() => onAssign(job, Number(tech), { position: when === 'next' ? 'next' : 'end', date: when === 'day' ? date : today, time: time || undefined })}>Assign</Button>
      </div>
    </li>
  );
}

export default function TaskBoardPage() {
  const [params, setParams] = useSearchParams();
  const [board, setBoard] = useState(null);
  const [list, setList] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const dragKey = useRef(null);
  const techId = Number(params.get('tech')) || null;

  const loadBoard = useCallback(() => {
    fetchTaskBoard().then(({ data }) => setBoard(data)).catch((e) => { toast.error(errMsg(e)); setBoard({ technicians: [], unassigned: [] }); });
  }, []);
  const take = (data) => {
    setList(byDate((data.tasks || []).filter((t) => t.state !== 'carrying')));
    setMeta({ today: data.today, tomorrow: data.tomorrow, carrying: (data.tasks || []).filter((t) => t.state === 'carrying') });
  };
  const loadTech = useCallback(() => {
    if (!techId) { setList(null); return; }
    setList(null);
    fetchFieldTasks(techId).then(({ data }) => take(data)).catch((e) => { toast.error(errMsg(e)); setList([]); });
  }, [techId]);
  useEffect(() => { loadBoard(); }, [loadBoard]);
  useEffect(() => { loadTech(); }, [loadTech]);
  useEffect(() => {
    if (!techId && board?.technicians?.length) {
      const first = board.technicians.find((t) => t.today || t.tomorrow || t.later) || board.technicians[0];
      setParams({ tech: String(first.user_id) }, { replace: true });
    }
  }, [board, techId, setParams]);

  const today = meta?.today || board?.today;
  const persist = async (next, ok) => {
    setList(next);
    setBusy(true);
    try {
      const { data } = await saveFieldTaskPlan(techId, next.map((t) => ({ key: t.key, date: t.date, time: t.time || null })));
      take(data);
      toast.success(ok || 'Saved');
      loadBoard();
    } catch (e) {
      toast.error(errMsg(e));
      loadTech();
    } finally { setBusy(false); }
  };
  const moveTo = (key, toDate, beforeKey) => {
    const item = list.find((t) => t.key === key);
    if (!item || item.state === 'active' || item.state === 'waiting') return;
    const rest = list.filter((t) => t.key !== key);
    const moved = { ...item, date: toDate };
    let idx = beforeKey ? rest.findIndex((t) => t.key === beforeKey) : -1;
    if (idx < 0) idx = rest.map((t) => t.state !== 'waiting' && t.date <= toDate).lastIndexOf(true) + 1;
    persist(byDate([...rest.slice(0, idx), moved, ...rest.slice(idx)]), toDate === item.date ? 'Order saved' : `Moved to ${toDate === today ? 'today' : fmtDay(toDate)}`);
  };
  const cardProps = {
    today,
    busy,
    techs: board?.technicians || [],
    techId,
    onDragStart: (key) => { dragKey.current = key; },
    onDropBefore: (t) => { const k = dragKey.current; dragKey.current = null; if (k && k !== t.key && t.state !== 'waiting') moveTo(k, t.date, t.key); },
    onTime: (t, v) => persist(list.map((x) => (x.key === t.key ? { ...x, time: v || null } : x)), v ? `Time set — ${fmtHm(v)}` : 'Time cleared'),
    onDay: (t, d) => moveTo(t.key, d < today ? today : d),
    onNext: (t) => {
      const rest = list.filter((x) => x.key !== t.key);
      const idx = rest.findIndex((x) => x.state !== 'active');
      const at = idx < 0 ? rest.length : idx;
      persist(byDate([...rest.slice(0, at), { ...t, date: today }, ...rest.slice(at)]), 'Next — it opens as soon as the current task is done');
    },
    onMove: (t, d) => {
      const same = list.filter((x) => x.date === t.date && x.state === 'pending');
      const i = same.findIndex((x) => x.key === t.key);
      const j = i + d;
      if (j < 0 || j >= same.length) return;
      const a = list.indexOf(same[i]); const b = list.indexOf(same[j]);
      const next = [...list];
      [next[a], next[b]] = [next[b], next[a]];
      persist(next, 'Order saved');
    },
    onPutBack: async (t) => {
      setBusy(true);
      try { const { data } = await releaseFieldTask(techId, t.key); take(data); toast.success('Put back to not started'); loadBoard(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    },
    onReassign: async (t, to) => {
      setBusy(true);
      try {
        await assignItem(Number(t.key.slice(5)), to);
        await planFieldTask({ user_id: to, key: t.key, position: 'end', date: t.date, time: t.time || undefined });
        toast.success(`Given to ${(board?.technicians || []).find((x) => x.user_id === to)?.name || 'the technician'}`);
        loadTech(); loadBoard();
      } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    },
  };
  const assign = async (job, to, plan) => {
    setBusy(true);
    try {
      if (job.kind === 'visit') await assignItem(job.item_id, to);
      else await assignPickup(job.ticket_id, { dispatch_mode: 'technician', technician_user_id: to, return_dc_number: job.return_dc_number });
      await planFieldTask({ user_id: to, key: job.key, ...plan });
      toast.success(plan.position === 'next' ? 'Assigned — next after the current task' : 'Assigned and planned');
      loadBoard();
      if (to === techId) loadTech(); else setParams({ tech: String(to) });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const groups = useMemo(() => {
    if (!list || !today) return [];
    const tomorrow = addDays(today, 1);
    const open = list.filter((t) => t.state !== 'waiting');
    const dates = [...new Set([today, tomorrow, ...open.map((t) => t.date)])].sort();
    let n = 1;
    return dates.map((d) => {
      const l = open.filter((t) => t.date === d);
      const g = { date: d, list: l, startN: n, title: d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : fmtDay(d), sub: d === today || d === tomorrow ? fmtDay(d) : '' };
      n += l.length;
      return g;
    });
  }, [list, today]);
  const waiting = (list || []).filter((t) => t.state === 'waiting');
  const techs = (board?.technicians || []).filter((t) => filter === 'all' || t.today || t.tomorrow || t.later || t.active.length);
  const sel = (board?.technicians || []).find((t) => t.user_id === techId);
  const totals = (board?.technicians || []).reduce((s, t) => ({ today: s.today + t.today, active: s.active + t.active.length, on: s.on + (t.checked_in ? 1 : 0) }), { today: 0, active: 0, on: 0 });

  return (
    <DeskShell title="Task board" breadcrumb="Support" subtitle="Plan each field technician's tasks — day, time and order. Drag to change it; every change saves at once.">
      {!board ? <EmptyState title="Loading…" /> : (
        <div className="c-tb">
          <aside className="c-tb-techs">
            <div className="c-tb-sum">
              <div><b>{totals.today}</b><span>tasks today</span></div>
              <div><b>{totals.active}</b><span>in progress</span></div>
              <div><b>{totals.on}</b><span>checked in</span></div>
            </div>
            <Segmented value={filter} onChange={setFilter} label="Show" options={[{ value: 'all', label: 'All' }, { value: 'busy', label: 'With tasks' }]} />
            <ul>
              {techs.map((t) => (
                <li key={t.user_id}>
                  <button type="button" className={`c-tb-tech${t.user_id === techId ? ' is-on' : ''}`} onClick={() => setParams({ tech: String(t.user_id) })}>
                    <span className="c-tb-tn"><i className={t.checked_in ? 'is-on' : ''} title={t.checked_in ? 'Checked in' : 'Not checked in'} />{t.name}</span>
                    <span className="c-tb-tc">
                      <span title="Today">{t.today} today</span>
                      {t.tomorrow > 0 && <span title="Tomorrow">{t.tomorrow} tmrw</span>}
                      {t.later > 0 && <span title="Later">{t.later} later</span>}
                      {t.waiting > 0 && <span title="Waiting for a part">{t.waiting} ⚙</span>}
                    </span>
                    {t.active[0] && <span className="c-tb-ta">● {t.active[0].customer || t.active[0].title}</span>}
                    {t.checked_in && <span className="c-tb-tk">{fmtKm(t.km)}</span>}
                  </button>
                </li>
              ))}
              {!techs.length && <li className="text-ink-3" style={{ padding: '8px' }}>No field technicians</li>}
            </ul>
          </aside>

          <main className="c-tb-main">
            {!techId ? <EmptyState title="Choose a technician" /> : list === null ? <EmptyState title="Loading…" /> : (
              <>
                <div className="c-tb-head">
                  <div>
                    <h2>{sel?.name || 'Technician'}</h2>
                    <span className="text-ink-3">{sel?.checked_in ? `Checked in · ${fmtKm(sel.km)} today` : 'Not checked in today'}</span>
                  </div>
                  <Link className="c-btn" to={`/carret/serve/my-work?tech=${techId}`}>Their My work ›</Link>
                </div>
                {list.filter((t) => t.state === 'active').length > 1 && (
                  <Notice tone="warn" title="More than one task in progress">Only one should be. Put back the one they are not at.</Notice>
                )}
                {groups.map((g) => (
                  <DayColumn key={g.date} title={g.title} sub={g.sub} date={g.date} list={g.list} startN={g.startN} onDropEnd={(d) => { const k = dragKey.current; dragKey.current = null; if (k) moveTo(k, d); }} {...cardProps} />
                ))}
                {waiting.length > 0 && <DayColumn title="Waiting for a part" sub="Comes back when the part is with them" date={null} list={waiting} startN={1} onDropEnd={() => {}} {...cardProps} />}
                {meta?.carrying?.length > 0 && (
                  <Notice tone="info" title="Carrying to the warehouse gate">{meta.carrying.map((t) => t.title).join(' · ')}</Notice>
                )}
              </>
            )}
          </main>

          <aside className="c-tb-un">
            <header className="c-tb-dayh"><b>Not assigned</b><span>Visits and technician pickups</span><span className="c-tb-cnt">{board.unassigned.length}</span></header>
            {board.unassigned.length ? (
              <ol className="c-tb-list">
                {board.unassigned.map((j) => <AssignCard key={j.key} job={j} techs={board.technicians} defaultTech={techId} today={board.today} busy={busy} onAssign={assign} />)}
              </ol>
            ) : <div className="c-tb-empty">Every job has a technician.</div>}
          </aside>
        </div>
      )}
    </DeskShell>
  );
}
