import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, EmptyState, Input, Money, Notice, Section, StatTile,
} from '../../../components/carret';
import { SECTIONS } from '../../../config/navigation';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { buildBlocks } from './todayTiles';

/**
 * Today (claude/pending.md item 11) — the new UI's home. One page for the day
 * and the month so far, replacing the old Overview (/dashboard), the Billing
 * dashboard (/finance/dashboard) and Operations (/carret).
 *
 * Every tile opens the list it counts, with the same filters, so the two
 * numbers agree. A tile shows only when the user may open its list, and the
 * API computes a block only for sections the user may view.
 *
 * Snapshot: pick an earlier day to see that day's dated figures (leads,
 * orders, deliveries, laptops out and back, payments), rebuilt from
 * timestamps. A "right now" figure cannot be rebuilt for a past day, and its
 * tile says so instead of showing today's number.
 */
const IST_MS = 330 * 60000;
const todayIst = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtCount = (n) => Number(n || 0).toLocaleString('en-IN');

/** The first screen in the new menu this user may open (no tiles at all). */
function firstAllowedScreen(hasPermission) {
  const allowed = (i) => (i.sections
    ? i.sections.some((s) => hasPermission(s, i.action))
    : hasPermission(i.section, i.action));
  return SECTIONS.flatMap((s) => s.items).find((i) => i.to.startsWith('/carret/') && allowed(i))?.to || null;
}

function TileDetail({ tile, data }) {
  if (data.unavailable) return <span style={{ whiteSpace: 'normal' }}>{data.unavailable}</span>;
  const parts = [];
  if (tile.money && !tile.ageing && data.amount != null) parts.push(<Money key="m" value={data.amount} />);
  if (tile.ready) {
    parts.push(<span key="r">{`rent ${fmtCount(data.rent)} · sell ${fmtCount(data.sell)} · either ${fmtCount(data.both)}${data.untagged ? ` · untagged ${fmtCount(data.untagged)}` : ''}`}</span>);
  }
  if (tile.ageing && data.buckets) {
    const b = data.buckets;
    parts.push(<span key="a">{`${fmtCount(data.count)} invoices · over 90 days `}<Money value={b.days_90_plus} /></span>);
  }
  if (tile.note) parts.push(<span key="n">{tile.note}</span>);
  if (!parts.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center" style={{ gap: '4px 8px', whiteSpace: 'normal' }}>
      {parts.map((p, i) => <React.Fragment key={p.key}>{i > 0 && <span aria-hidden="true">·</span>}{p}</React.Fragment>)}
    </span>
  );
}

function DashTile({ tile, data, onOpen }) {
  const unavailable = Boolean(data.unavailable);
  // Outstanding leads with the amount (its detail line carries the invoice count).
  let value = unavailable ? '—' : fmtCount(data.count);
  if (!unavailable && tile.ageing) value = <Money value={data.amount} />;
  return (
    <button
      type="button"
      onClick={() => onOpen(tile.to)}
      className="text-left bg-transparent border-0 p-0 cursor-pointer"
      title={`Open the list behind “${tile.label}”`}
      style={{ minWidth: 0 }}
    >
      <StatTile
        label={tile.label}
        value={value}
        family={unavailable ? null : tile.family}
        delta={<TileDetail tile={tile} data={data} />}
      />
    </button>
  );
}

function FloorStages({ data, onOpen }) {
  if (data.unavailable || !data.stages?.length) return null;
  return (
    <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '12px' }}>
      {data.stages.map((s) => (
        <Button key={s.name} variant="quiet" onClick={() => onOpen(`/carret/produce/floor?stage=${encodeURIComponent(s.name)}`)}>
          {s.name} <span className="tabular-nums text-ink-3">{fmtCount(s.count)}</span>
        </Button>
      ))}
    </div>
  );
}

function Block({ block, data, canOpen, onOpen }) {
  const tiles = block.tiles.filter((t) => data[t.key] && canOpen(t.sections));
  if (!tiles.length) return null;
  const floor = tiles.find((t) => t.stages);
  return (
    <Section title={block.title}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '12px' }}>
        {tiles.map((t) => <DashTile key={t.key} tile={t} data={data[t.key]} onOpen={onOpen} />)}
      </div>
      {floor && <FloorStages data={data[floor.key]} onOpen={onOpen} />}
    </Section>
  );
}

export default function TodayDashboardPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [params, setParams] = useSearchParams();
  const today = todayIst();
  const requested = params.get('date');
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today ? requested : today;
  const isToday = date === today;
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get('/dashboard/today', { params: isToday ? {} : { date } })
      .then(({ data }) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((e) => {
        if (!cancelled) setState({ loading: false, error: e?.response?.data?.message || 'Could not load the dashboard.', data: null });
      });
    return () => { cancelled = true; };
  }, [date, isToday]);
  useEffect(() => load(), [load]);

  const blocks = useMemo(() => buildBlocks({
    date,
    from: `${date.slice(0, 7)}-01`,
    dayLabel: isToday ? 'today' : `on ${fmtDay(date)}`,
  }), [date, isToday]);
  const canOpen = useCallback((sections) => sections.some((s) => hasPermission(s, 'view')), [hasPermission]);
  const onOpen = useCallback((to) => navigate(to), [navigate]);
  const setDate = (d) => {
    const p = new URLSearchParams(params);
    if (d && d !== today) p.set('date', d); else p.delete('date');
    setParams(p, { replace: true });
  };

  const data = state.data?.blocks;
  const visible = data
    ? blocks.filter((b) => data[b.key] && b.tiles.some((t) => data[b.key][t.key] && canOpen(t.sections)))
    : [];

  // Nothing on the dashboard for this user: send them to a screen they can use
  // (what /carret/home did before it became the dashboard).
  if (data && !visible.length) {
    const first = firstAllowedScreen(hasPermission);
    if (first) return <Navigate to={first} replace />;
  }

  return (
    <DeskShell
      title="Today"
      breadcrumb="Overview"
      subtitle={isToday
        ? 'The day and the month so far. Every tile opens the list behind its number.'
        : `Snapshot of ${fmtDay(date)}. Dated figures are rebuilt from records; figures that only exist "right now" say so.`}
      actions={(
        <span className="inline-flex items-center" style={{ gap: '8px' }}>
          <label className="font-ui text-ink-3" htmlFor="today-date" style={{ fontSize: '13px' }}>Day</label>
          <Input id="today-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '11rem' }} />
          {!isToday && <Button variant="quiet" onClick={() => setDate(today)}>Back to today</Button>}
          <Button variant="secondary" onClick={load}>Refresh</Button>
        </span>
      )}
    >
      <div className="c-stack">
        {!isToday && (
          <Notice tone="info" title={`Showing ${fmtDay(date)}`}>
            Leads, quotations, orders, sales, deliveries, laptops out and back, invoicing and payments are counted for
            that day (and that month up to it). Queues and stock levels are not kept day by day, so those tiles are blank.
          </Notice>
        )}
        {state.loading && !data && <EmptyState title="Loading…" />}
        {state.error && <EmptyState title="Could not load the dashboard" body={state.error} />}
        {data && !visible.length && (
          <EmptyState title="Nothing to show" body="No area of the dashboard is enabled for your role yet." />
        )}
        {data && visible.map((b) => (
          <Block key={b.key} block={b} data={data[b.key]} canOpen={canOpen} onOpen={onOpen} />
        ))}
      </div>
    </DeskShell>
  );
}
