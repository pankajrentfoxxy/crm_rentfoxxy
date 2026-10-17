import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import { Button, EmptyState, Input, Notice, Select } from '../../../components/carret';
import { assignItem, assignPickup } from '../serve/serveApi';
import {
  TASK_KIND_COLOR, TASK_KIND_LABEL, fetchFieldTasks, fetchTaskBoard, fmtDay, fmtHm, fmtKm, fmtTime, planFieldTask, releaseFieldTask,
  reopenFieldDay, saveFieldTaskPlan, startFieldDayFor,
} from './fieldApi';

/**
 * Support → Task board (17 Oct 2026, migration 440). The lead plans each field
 * technician's work: which task, which day, what time, in what order.
 *
 *   top      today in numbers; the technicians as chips (load, checked in,
 *            what is in progress) — tap one to plan their work
 *   plan     their tasks as a timeline, by day (Today / Tomorrow / Later /
 *            Waiting tabs). Drag a card by its handle onto another card to
 *            reorder, or onto a day tab to move it; ↑ ↓ and "Move to" do the
 *            same on a phone. Tap a card for details, time, Do next, put back,
 *            give to another technician.
 *   side     support jobs nobody holds yet — assign next, last today, or on
 *            a day and time
 *
 * Every change saves at once. The technician starts only today's tasks, one at
 * a time, in this order; tomorrow's and later ones show on My work, not opened.
 */
const errMsg = (e) => e?.response?.data?.message || e?.message || 'That did not work.';
const addDays = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const DAY_TARGET = 8; // a full day for the load bar
const AVATAR = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#db2777', '#0891b2', '#4f46e5', '#65a30d'];
const avatarColor = (name = '') => AVATAR[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR.length];
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const KINDS = [
  { key: 'all', label: 'All' },
  { key: 'visit', label: 'Visits' },
  { key: 'pickup', label: 'Pickups' },
  { key: 'delivery', label: 'Deliveries' },
];
const kindGroup = (k) => (k === 'return' ? 'pickup' : k === 'vendor' ? 'delivery' : k);
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

function Avatar({ name, on, size = 40 }) {
  return (
    <span className={`c-tb2-av${on ? ' is-on' : ''}`} style={{ '--av': avatarColor(name), width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function TechChip({ t, on, onPick }) {
  const load = Math.min(1, t.today / DAY_TARGET);
  return (
    <button type="button" className={`c-tb2-tech${on ? ' is-on' : ''}`} onClick={onPick} aria-pressed={on}>
      <Avatar name={t.name} on={t.checked_in} />
      <span className="c-tb2-tech-m">
        <b>{t.name}</b>
        <span className="c-tb2-tech-s">
          {t.active[0] ? <span className="is-live">● On a task</span> : <span className={t.day_state === 'ended' ? 'is-out' : ''}>{t.day_state === 'on' ? 'Checked in' : t.day_state === 'ended' ? 'Checked out' : 'Not checked in'}</span>}
          {t.checked_in && <span>{fmtKm(t.km)}</span>}
        </span>
        <span className="c-tb2-load" title={`${t.today} today`}><i style={{ width: `${load * 100}%`, background: load >= 1 ? '#dc2626' : load > 0.7 ? '#d97706' : '#16a34a' }} /></span>
        <span className="c-tb2-tech-c">
          <span><b>{t.today}</b> today</span>
          {t.tomorrow > 0 && <span><b>{t.tomorrow}</b> tmrw</span>}
          {t.later > 0 && <span><b>{t.later}</b> later</span>}
          {t.waiting > 0 && <span><b>{t.waiting}</b> ⚙</span>}
        </span>
      </span>
    </button>
  );
}

function TaskCard({ t, n, today, busy, open, flash, onToggle, drag, onTime, onDay, onNext, onMove, onPutBack, onReassign, techs, techId, first, last }) {
  const [over, setOver] = useState(false);
  const [giveTo, setGiveTo] = useState('');
  const fixed = t.state === 'active' || t.state === 'waiting';
  const tomorrow = addDays(today, 1);
  return (
    <li
      className={`c-tb2-item is-${t.state}${over ? ' is-over' : ''}${flash ? ' is-flash' : ''}${drag.key === t.key ? ' is-drag' : ''}`}
      style={{ '--k': TASK_KIND_COLOR[t.kind] || '#64748b' }}
      onDragOver={(e) => { if (drag.key && drag.key !== t.key && t.state !== 'active' && t.state !== 'waiting') { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); drag.dropBefore(t); }}
    >
      <div className="c-tb2-rail">
        <span className="c-tb2-time">{t.time ? fmtHm(t.time) : (t.state === 'active' ? 'Now' : '')}</span>
        <span className="c-tb2-node">{t.state === 'waiting' ? '⚙' : t.state === 'active' ? '●' : n}</span>
      </div>
      <div className="c-tb2-card">
        <div className="c-tb2-head">
          <span
            className={`c-tb2-grip${fixed ? ' is-off' : ''}`}
            draggable={!fixed && !busy}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.key); drag.start(t.key); }}
            onDragEnd={drag.end}
            title={fixed ? '' : 'Drag to reorder, or onto a day'}
            aria-hidden="true"
          >⋮⋮</span>
          <button type="button" className="c-tb2-main" onClick={onToggle} aria-expanded={open}>
            <span className="c-tb2-top">
              <span className="c-tq-chip">{TASK_KIND_LABEL[t.kind] || t.kind}</span>
              {t.state === 'active' && <span className="c-tb2-badge is-live">In progress</span>}
              {t.state === 'waiting' && <span className="c-tb2-badge">Waiting for part</span>}
              {t.overdue && t.state === 'pending' && <span className="c-tb2-badge is-warn">Carried over</span>}
              {t.priority && t.priority !== 'normal' && <span className="c-tb2-badge is-warn">{t.priority}</span>}
              {t.sla === 'breached' && <span className="c-tb2-badge is-red">SLA late</span>}
            </span>
            <b className="c-tb2-cust">{t.customer || t.title}</b>
            <span className="c-tb2-sub">{t.title}{t.address ? ` · ${t.address}` : ''}</span>
          </button>
          <span className="c-tb2-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </div>

        {open && (
          <div className="c-tb2-more">
            <dl className="c-tb2-dl">
              {t.laptops?.length > 0 && <div><dt>Laptop</dt><dd className="font-mono">{t.laptops.join('  ·  ')}</dd></div>}
              {t.issue && <div><dt>Problem</dt><dd>{t.issue}</dd></div>}
              {t.remarks && <div><dt>Note</dt><dd>“{t.remarks}”</dd></div>}
              {t.appointment && <div><dt>Customer slot</dt><dd>{new Date(t.appointment).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</dd></div>}
              {t.step && <div><dt>Next step</dt><dd>{t.step}</dd></div>}
              {t.phone && <div><dt>Phone</dt><dd><a href={`tel:${t.phone}`}>{t.phone}</a></dd></div>}
              {t.ticket_id && <div><dt>Ticket</dt><dd><Link to={`/carret/serve/tickets/${t.ticket_id}`}>#{t.ticket_id} ›</Link></dd></div>}
            </dl>
            {t.state !== 'waiting' && (
              <div className="c-tb2-ctl">
                <label className="c-tb2-f"><span>Time</span><Input type="time" value={t.time || ''} disabled={busy} onChange={(e) => onTime(t, e.target.value)} /></label>
                {t.state !== 'active' && (
                  <label className="c-tb2-f"><span>Day</span><Input type="date" min={today} value={t.date || today} disabled={busy} onChange={(e) => e.target.value && onDay(t, e.target.value)} /></label>
                )}
              </div>
            )}
            {t.state === 'pending' && (
              <div className="c-tb2-quick">
                {t.date !== today && <button type="button" disabled={busy} onClick={() => onDay(t, today)}>→ Today</button>}
                {t.date !== tomorrow && <button type="button" disabled={busy} onClick={() => onDay(t, tomorrow)}>→ Tomorrow</button>}
                <button type="button" disabled={busy} onClick={() => onNext(t)} className="is-accent">⚡ Do next</button>
              </div>
            )}
            {t.state === 'active' && (
              <div className="c-tb2-quick">
                <button type="button" disabled={busy} onClick={() => onPutBack(t)}>↺ Put back to not started</button>
                <small className="text-ink-3">If they reached by mistake or the customer was away. Nothing collected or delivered is undone.</small>
              </div>
            )}
            {t.state === 'pending' && t.key.startsWith('item:') && techs.length > 1 && (
              <div className="c-tb2-give">
                <Select
                  value={giveTo}
                  onChange={(e) => setGiveTo(e.target.value)}
                  aria-label="Give to another technician"
                  options={[{ value: '', label: 'Give to another technician…' }, ...techs.filter((x) => x.user_id !== techId).map((x) => ({ value: String(x.user_id), label: `${x.name} · ${x.today} today` }))]}
                />
                <Button disabled={busy || !giveTo} onClick={() => { onReassign(t, Number(giveTo)); setGiveTo(''); }}>Give</Button>
              </div>
            )}
          </div>
        )}
      </div>
      {t.state === 'pending' && (
        <div className="c-tb2-arrows">
          <button type="button" disabled={busy || first} onClick={() => onMove(t, -1)} aria-label="Move up">▲</button>
          <button type="button" disabled={busy || last} onClick={() => onMove(t, 1)} aria-label="Move down">▼</button>
        </div>
      )}
    </li>
  );
}

/**
 * The technician's day, for the lead (migration 441): checked out (by mistake,
 * or at 10 PM) → check them in again; never started → check them in at an office.
 */
function DayControl({ tech, places, busy, onReopen, onStart }) {
  const [place, setPlace] = useState('');
  useEffect(() => { setPlace(String((places || []).find((p) => p.is_default)?.place_id || places?.[0]?.place_id || '')); }, [places]);
  if (!tech || tech.day_state === 'on') return null;
  const ended = tech.day_state === 'ended';
  return (
    <div className={`c-tb2-dayc${ended ? ' is-ended' : ''}`}>
      <span className="c-tb2-dayc-i" aria-hidden="true">{ended ? '⏾' : '○'}</span>
      <div className="min-w-0">
        <b>{ended ? `Checked out${tech.day_ended_at ? ` at ${fmtTime(tech.day_ended_at)}` : ''}` : 'Not checked in today'}</b>
        <small>{ended
          ? `${tech.day_end_label || ''} — they cannot mark “reached” now. Check them in again: their next stop is measured from their last one.`
          : 'They cannot mark “reached” until they check in. Check them in at an office if they cannot.'}</small>
      </div>
      {ended ? (
        <Button variant="primary" disabled={busy} onClick={onReopen}>Check in again</Button>
      ) : (
        <span className="c-tb2-dayc-a">
          <Select value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Check-in place" options={(places || []).map((p) => ({ value: String(p.place_id), label: p.name }))} />
          <Button variant="primary" disabled={busy || !place} onClick={() => onStart(Number(place))}>Check in for them</Button>
        </span>
      )}
    </div>
  );
}

function AssignCard({ job, techs, defaultTech, today, busy, onAssign }) {
  const [tech, setTech] = useState(defaultTech ? String(defaultTech) : '');
  const [when, setWhen] = useState('next');
  const [date, setDate] = useState(addDays(today, 1));
  const [time, setTime] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { if (defaultTech) setTech(String(defaultTech)); }, [defaultTech]);
  return (
    <li className="c-tb2-un-item" style={{ '--k': TASK_KIND_COLOR[job.kind] || '#64748b' }}>
      <button type="button" className="c-tb2-un-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="c-tq-chip">{TASK_KIND_LABEL[job.kind] || job.kind}</span>
        <b>{job.customer}</b>
        <small>{job.title}{job.address ? ` · ${job.address}` : ''}</small>
        {job.priority && job.priority !== 'normal' && <span className="c-tb2-badge is-warn">{job.priority}</span>}
      </button>
      {open && (
        <div className="c-tb2-un-b">
          {job.laptops?.length > 0 && <div className="font-mono c-tb2-sub">{job.laptops.join('  ·  ')}</div>}
          {job.issue && <div className="c-tb2-sub">Problem: {job.issue}</div>}
          <Link className="c-tb2-sub" to={`/carret/serve/tickets/${job.ticket_id}`}>Ticket #{job.ticket_id} ›</Link>
          <div className="c-tb2-pick">
            {techs.map((x) => (
              <button key={x.user_id} type="button" className={String(x.user_id) === tech ? 'is-on' : ''} onClick={() => setTech(String(x.user_id))} title={`${x.today} today`}>
                <Avatar name={x.name} on={x.checked_in} size={30} />
                <span>{x.name.split(' ')[0]}</span>
                <small>{x.today}</small>
              </button>
            ))}
          </div>
          <div className="c-tb2-when" role="group" aria-label="When">
            {[['next', '⚡ Do next'], ['end', 'Today, last'], ['day', 'On a day']].map(([v, l]) => (
              <button key={v} type="button" className={when === v ? 'is-on' : ''} onClick={() => setWhen(v)}>{l}</button>
            ))}
          </div>
          <div className="c-tb2-ctl">
            {when === 'day' && <label className="c-tb2-f"><span>Day</span><Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>}
            <label className="c-tb2-f"><span>Time (optional)</span><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
          <Button variant="primary" disabled={busy || !tech} onClick={() => onAssign(job, Number(tech), { position: when === 'next' ? 'next' : 'end', date: when === 'day' ? date : today, time: time || undefined })}>
            {tech ? `Assign to ${(techs.find((x) => String(x.user_id) === tech)?.name || '').split(' ')[0]}` : 'Choose a technician'}
          </Button>
        </div>
      )}
    </li>
  );
}

export default function TaskBoardPage() {
  const [params, setParams] = useSearchParams();
  const [board, setBoard] = useState(null);
  const [list, setList] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('today');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [openKey, setOpenKey] = useState(null);
  const [flash, setFlash] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [overTab, setOverTab] = useState(null);
  const [showUn, setShowUn] = useState(false);
  const dragRef = useRef(null);
  const techId = Number(params.get('tech')) || null;

  const loadBoard = useCallback(() => {
    fetchTaskBoard().then(({ data }) => setBoard(data)).catch((e) => { toast.error(errMsg(e)); setBoard({ technicians: [], unassigned: [], failed: true }); });
  }, []);
  const take = (data) => {
    setList(byDate((data.tasks || []).filter((t) => t.state !== 'carrying')));
    setMeta({ today: data.today, carrying: (data.tasks || []).filter((t) => t.state === 'carrying') });
  };
  const loadTech = useCallback(() => {
    if (!techId) { setList(null); return; }
    setList(null);
    fetchFieldTasks(techId).then(({ data }) => take(data)).catch((e) => { toast.error(errMsg(e)); setList([]); });
  }, [techId]);
  useEffect(() => { loadBoard(); }, [loadBoard]);
  useEffect(() => { loadTech(); setOpenKey(null); }, [loadTech]);
  useEffect(() => {
    if (!techId && board?.technicians?.length) {
      const first = board.technicians.find((t) => t.today || t.tomorrow || t.later) || board.technicians[0];
      setParams({ tech: String(first.user_id) }, { replace: true });
    }
  }, [board, techId, setParams]);
  useEffect(() => { if (!flash) return undefined; const t = setTimeout(() => setFlash(null), 1600); return () => clearTimeout(t); }, [flash]);

  const today = meta?.today || board?.today;
  const tomorrow = today ? addDays(today, 1) : null;
  const persist = async (next, ok, movedKey) => {
    setList(next);
    if (movedKey) setFlash(movedKey);
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
    let idx = beforeKey ? rest.findIndex((t) => t.key === beforeKey) : -1;
    if (idx < 0) idx = rest.map((t) => t.state !== 'waiting' && t.date <= toDate).lastIndexOf(true) + 1;
    const label = toDate === today ? 'today' : toDate === tomorrow ? 'tomorrow' : fmtDay(toDate);
    persist(byDate([...rest.slice(0, idx), { ...item, date: toDate }, ...rest.slice(idx)]), toDate === item.date ? 'Order saved' : `Moved to ${label}`, key);
  };
  const drag = {
    key: dragKey,
    start: (k) => { dragRef.current = k; setDragKey(k); },
    end: () => { dragRef.current = null; setDragKey(null); setOverTab(null); },
    dropBefore: (t) => { const k = dragRef.current; drag.end(); if (k && k !== t.key && t.state !== 'waiting' && t.state !== 'active') moveTo(k, t.date, t.key); },
  };
  const cardProps = {
    today,
    busy,
    drag,
    techs: board?.technicians || [],
    techId,
    onTime: (t, v) => persist(list.map((x) => (x.key === t.key ? { ...x, time: v || null } : x)), v ? `Time set — ${fmtHm(v)}` : 'Time cleared', t.key),
    onDay: (t, d) => moveTo(t.key, d < today ? today : d),
    onNext: (t) => {
      const rest = list.filter((x) => x.key !== t.key);
      const idx = rest.findIndex((x) => x.state !== 'active');
      const at = idx < 0 ? rest.length : idx;
      setTab('today');
      persist(byDate([...rest.slice(0, at), { ...t, date: today }, ...rest.slice(at)]), 'Next — it opens as soon as the current task is done', t.key);
    },
    onMove: (t, d) => {
      const same = list.filter((x) => x.date === t.date && x.state === 'pending');
      const i = same.findIndex((x) => x.key === t.key);
      const j = i + d;
      if (j < 0 || j >= same.length) return;
      const a = list.indexOf(same[i]); const b = list.indexOf(same[j]);
      const next = [...list];
      [next[a], next[b]] = [next[b], next[a]];
      persist(next, 'Order saved', t.key);
    },
    onPutBack: async (t) => {
      setBusy(true);
      try { const { data } = await releaseFieldTask(techId, t.key); take(data); setFlash(t.key); toast.success('Put back to not started'); loadBoard(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
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
      setFlash(job.key);
      setTab(plan.date && plan.date !== today ? (plan.date === tomorrow ? 'tomorrow' : 'later') : 'today');
      loadBoard();
      if (to === techId) loadTech(); else setParams({ tech: String(to) });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const dayAction = async (fn, ok) => {
    setBusy(true);
    try { const { data } = await fn(); toast.success(data?.message || ok); loadBoard(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const all = list || [];
  const buckets = {
    today: all.filter((t) => t.state !== 'waiting' && t.date === today),
    tomorrow: all.filter((t) => t.state !== 'waiting' && t.date === tomorrow),
    later: all.filter((t) => t.state !== 'waiting' && today && t.date > tomorrow),
    waiting: all.filter((t) => t.state === 'waiting'),
  };
  const match = (t) => (kind === 'all' || kindGroup(t.kind) === kind)
    && (!q.trim() || [t.customer, t.title, t.address, ...(t.laptops || [])].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase()));
  const shown = buckets[tab].filter(match);
  const laterDays = useMemo(() => [...new Set(buckets.later.map((t) => t.date))].sort(), [buckets.later]);
  const tabDate = { today, tomorrow, later: today ? addDays(today, 2) : null };
  const dropOnTab = (key) => {
    const k = dragRef.current;
    drag.end();
    if (!k || !tabDate[key]) return;
    const item = all.find((t) => t.key === k);
    const target = key === 'later' && item?.date > tomorrow ? item.date : tabDate[key];
    moveTo(k, target);
  };

  const techs = board?.technicians || [];
  const sel = techs.find((t) => t.user_id === techId);
  const totals = techs.reduce((s, t) => ({ today: s.today + t.today, active: s.active + t.active.length, on: s.on + (t.checked_in ? 1 : 0), km: s.km + Number(t.km || 0) }), { today: 0, active: 0, on: 0, km: 0 });
  const activeNow = all.filter((t) => t.state === 'active');
  const unassigned = board?.unassigned || [];

  const renderList = (items, startN = 1) => (
    <ol className="c-tb2-line">
      {items.map((t, i) => {
        const same = items.filter((x) => x.state === 'pending' && x.date === t.date);
        const pos = same.indexOf(t);
        return (
          <TaskCard
            key={t.key}
            t={t}
            n={startN + i}
            open={openKey === t.key}
            flash={flash === t.key}
            onToggle={() => setOpenKey((k) => (k === t.key ? null : t.key))}
            first={pos <= 0}
            last={pos === same.length - 1}
            {...cardProps}
          />
        );
      })}
    </ol>
  );

  return (
    <DeskShell title="Task board" breadcrumb="Support" subtitle="Plan every field technician's day — order, day and time. Changes save as you make them.">
      {!board ? <EmptyState title="Loading the board…" /> : (
        <div className="c-tb2">
          <div className="c-tb2-kpis">
            <div className="c-tb2-kpi"><span>Tasks today</span><b>{totals.today}</b></div>
            <div className="c-tb2-kpi is-red"><span>In progress</span><b>{totals.active}</b></div>
            <button type="button" className={`c-tb2-kpi is-warn${unassigned.length ? ' is-click' : ''}`} onClick={() => setShowUn(true)}><span>Not assigned</span><b>{unassigned.length}</b></button>
            <div className="c-tb2-kpi is-good"><span>Checked in</span><b>{totals.on}<small>/{techs.length}</small></b></div>
            <div className="c-tb2-kpi"><span>Travelled today</span><b>{fmtKm(totals.km)}</b></div>
          </div>

          <div className="c-tb2-techs" role="list" aria-label="Technicians">
            {techs.map((t) => <TechChip key={t.user_id} t={t} on={t.user_id === techId} onPick={() => { setParams({ tech: String(t.user_id) }); setTab('today'); }} />)}
            {!techs.length && <div className="c-tb2-empty">No field technicians found.</div>}
          </div>

          <div className="c-tb2-grid">
            <section className="c-tb2-plan">
              {!techId ? <EmptyState title="Choose a technician above" /> : (
                <>
                  <header className="c-tb2-ph">
                    <Avatar name={sel?.name || ''} on={sel?.checked_in} size={48} />
                    <div className="min-w-0">
                      <h2>{sel?.name || 'Technician'}</h2>
                      <span>{sel?.day_state === 'on' ? `Checked in · ${fmtKm(sel.km)} today` : sel?.day_state === 'ended' ? `Checked out · ${fmtKm(sel.km)} today` : 'Not checked in'} · {buckets.today.length} today</span>
                    </div>
                    <Link className="c-btn" to={`/carret/serve/my-work?tech=${techId}`}>Their screen ›</Link>
                  </header>

                  <DayControl
                    tech={sel}
                    places={board.places}
                    busy={busy}
                    onReopen={() => dayAction(() => reopenFieldDay(techId), 'Checked in again — they can work now')}
                    onStart={(placeId) => dayAction(() => startFieldDayFor(techId, placeId), 'Checked in — they can work now')}
                  />
                  {activeNow[0] && (
                    <div className="c-tb2-now">
                      <span className="c-tb2-pulse" aria-hidden="true" />
                      <div className="min-w-0"><small>Working on now</small><b>{activeNow[0].customer || activeNow[0].title}</b><span>{activeNow[0].step}</span></div>
                    </div>
                  )}
                  {activeNow.length > 1 && <Notice tone="warn" title={`${activeNow.length} tasks in progress`}>Only one should be. Open the one they are not at and put it back.</Notice>}

                  <div className="c-tb2-tabs" role="tablist">
                    {[['today', 'Today', today], ['tomorrow', 'Tomorrow', tomorrow], ['later', 'Later', null], ['waiting', 'Waiting', null]].map(([k, label, d]) => (
                      <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={tab === k}
                        className={`${tab === k ? 'is-on' : ''}${overTab === k ? ' is-over' : ''}${dragKey && k !== 'waiting' ? ' is-target' : ''}`}
                        onClick={() => setTab(k)}
                        onDragOver={(e) => { if (dragKey && k !== 'waiting') { e.preventDefault(); setOverTab(k); } }}
                        onDragLeave={() => setOverTab(null)}
                        onDrop={(e) => { e.preventDefault(); dropOnTab(k); }}
                      >
                        <span>{label}</span>
                        <small>{d ? fmtDay(d) : (k === 'later' ? 'After tomorrow' : 'For a part')}</small>
                        <i>{buckets[k].length}</i>
                      </button>
                    ))}
                  </div>
                  {dragKey && <div className="c-tb2-hint">Drop on a card to put it before that one, or on a day above to move it there.</div>}

                  <div className="c-tb2-filters">
                    <div className="c-tb2-kinds">
                      {KINDS.map((k) => <button key={k.key} type="button" className={kind === k.key ? 'is-on' : ''} onClick={() => setKind(k.key)}>{k.label}</button>)}
                    </div>
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, laptop, area…" aria-label="Search tasks" />
                  </div>

                  {list === null ? <EmptyState title="Loading…" /> : !shown.length ? (
                    <div className="c-tb2-empty is-big">
                      <span aria-hidden="true">{tab === 'waiting' ? '⚙' : '🗓'}</span>
                      <b>{q || kind !== 'all' ? 'Nothing matches' : tab === 'waiting' ? 'Nothing waiting for a part' : `Nothing planned ${tab === 'today' ? 'today' : tab === 'tomorrow' ? 'tomorrow' : 'later'}`}</b>
                      {tab !== 'waiting' && !q && kind === 'all' && <small>Assign a job from “Not assigned”, or drag a task onto this day.</small>}
                    </div>
                  ) : tab === 'later' ? (
                    laterDays.map((d) => {
                      const items = shown.filter((t) => t.date === d);
                      return items.length ? <div key={d} className="c-tb2-dgroup"><h3>{fmtDay(d)}</h3>{renderList(items)}</div> : null;
                    })
                  ) : renderList(shown)}

                  {meta?.carrying?.length > 0 && (
                    <div className="c-tb2-carry"><b>🚚 Carrying to the warehouse gate</b><span>{meta.carrying.map((t) => t.title).join(' · ')}</span></div>
                  )}
                </>
              )}
            </section>

            <aside className={`c-tb2-un${showUn ? ' is-open' : ''}`}>
              <header>
                <b>Not assigned</b>
                <span className="c-tb2-count">{unassigned.length}</span>
                <button type="button" className="c-tb2-x" onClick={() => setShowUn(false)} aria-label="Close">✕</button>
              </header>
              <p className="text-ink-3">Visits and technician pickups nobody holds yet. Tap one to assign it.</p>
              {unassigned.length ? (
                <ul className="c-tb2-un-l">
                  {unassigned.map((j) => <AssignCard key={j.key} job={j} techs={techs} defaultTech={techId} today={board.today} busy={busy} onAssign={(...a) => { setShowUn(false); assign(...a); }} />)}
                </ul>
              ) : <div className="c-tb2-empty is-big"><span aria-hidden="true">✓</span><b>Every job has a technician</b></div>}
            </aside>
            {showUn && <button type="button" className="c-tb2-scrim" aria-label="Close" onClick={() => setShowUn(false)} />}
          </div>
          {unassigned.length > 0 && !showUn && (
            <button type="button" className="c-tb2-fab" onClick={() => setShowUn(true)}>＋ {unassigned.length} not assigned</button>
          )}
        </div>
      )}
    </DeskShell>
  );
}
