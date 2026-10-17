/** Shared pieces for My report and the field dashboard (17 Oct 2026). */
import React from 'react';
import { Link } from 'react-router-dom';
import { Input, Segmented } from '../../../components/carret';
import { TASK_KINDS, fmtKm, fmtTime, kindOf } from './fieldApi';

export const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];

export function PeriodPicker({ period, onPeriod, custom, onCustom }) {
  return (
    <div className="c-period">
      <Segmented value={period} onChange={onPeriod} label="Period" options={PERIODS} />
      {period === 'custom' && (
        <span className="c-period-c">
          <Input type="date" value={custom.from || ''} onChange={(e) => onCustom({ ...custom, from: e.target.value })} aria-label="From" />
          <span className="text-ink-3">to</span>
          <Input type="date" value={custom.to || ''} onChange={(e) => onCustom({ ...custom, to: e.target.value })} aria-label="To" />
        </span>
      )}
    </div>
  );
}

/** One coloured tile per kind of task, then km travelled. */
export function KindTiles({ counts = {}, km, total }) {
  return (
    <div className="c-ktiles">
      <div className="c-ktile is-total"><b>{total || 0}</b><span>Tasks done</span></div>
      {TASK_KINDS.map((k) => (
        <div key={k.key} className="c-ktile" style={{ '--k': k.color }}><b>{counts[k.key] || 0}</b><span>{k.label}</span></div>
      ))}
      {km != null && <div className="c-ktile is-km"><b>{fmtKm(km)}</b><span>Travelled by road</span></div>}
    </div>
  );
}

/** Stacked bar per day (tasks by kind), with the day's km under it. */
export function DayChart({ series = [] }) {
  if (series.length < 2) return null;
  const max = Math.max(1, ...series.map((d) => TASK_KINDS.reduce((s, k) => s + (d[k.key] || 0), 0)));
  return (
    <div className="c-daychart" role="img" aria-label="Tasks per day">
      {series.map((d) => {
        const total = TASK_KINDS.reduce((s, k) => s + (d[k.key] || 0), 0);
        return (
          <div key={d.day} className="c-daychart-col" title={`${d.day}: ${total} task(s), ${fmtKm(d.km)}`}>
            <span className="c-daychart-n">{total || ''}</span>
            <div className="c-daychart-bar" style={{ height: `${(total / max) * 100}%` }}>
              {TASK_KINDS.map((k) => (d[k.key] ? <i key={k.key} style={{ flex: d[k.key], background: k.color }} /> : null))}
            </div>
            <span className="c-daychart-d">{new Date(`${d.day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
            {d.km > 0 && <span className="c-daychart-km">{Math.round(d.km)} km</span>}
          </div>
        );
      })}
    </div>
  );
}

export function KindLegend() {
  return (
    <div className="c-klegend">
      {TASK_KINDS.map((k) => <span key={k.key}><i style={{ background: k.color }} />{k.short}</span>)}
    </div>
  );
}

export function TaskList({ tasks = [] }) {
  if (!tasks.length) return <p className="text-ink-3" style={{ margin: 0 }}>Nothing in this period.</p>;
  return (
    <ul className="c-tasklist">
      {tasks.map((t, n) => {
        const k = kindOf(t.kind);
        return (
          // eslint-disable-next-line react/no-array-index-key
          <li key={`${t.kind}-${t.ref}-${n}`} style={{ '--k': k.color }}>
            <span className="c-tasklist-k">{k.short}</span>
            <span className="min-w-0">
              <b>{t.customer || '—'}</b>
              <small>{[t.code, t.result].filter(Boolean).join(' · ')}</small>
            </span>
            <span className="c-tasklist-r">
              {t.link ? <Link to={t.link} className="font-mono">{t.ref}</Link> : <span className="font-mono">{t.ref}</span>}
              <small>{new Date(t.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</small>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const LEG_KIND = { visit: 'Visit', pickup: 'Pickup', delivery: 'Delivery', vendor: 'Vendor', warehouse: 'Warehouse', end: 'Back' };
/** One day's route: check-in, every stop with its road km, the way back. */
export function TravelDay({ day }) {
  return (
    <div className="c-route">
      <div className="c-route-h">
        <b>{new Date(day.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</b>
        <span>{fmtKm(day.total_km)} · {day.stops} stop{day.stops === 1 ? '' : 's'}{day.total_min ? ` · ${Math.floor(day.total_min / 60)}h ${day.total_min % 60}m on the road` : ''}{day.user_name ? ` · ${day.user_name}` : ''}</span>
      </div>
      <ol className="c-route-list">
        <li className="is-start"><span className="c-route-dot" /><span><b>{day.start_label}</b><small>Checked in {fmtTime(day.started_at)}</small></span></li>
        {(day.legs || []).map((l) => (
          <li key={l.leg_id} className={l.kind === 'end' ? 'is-end' : ''}>
            <span className="c-route-dot" />
            <span className="min-w-0">
              <b>{l.kind === 'end' ? (l.label || 'Back') : (l.label || l.ref || LEG_KIND[l.kind])}</b>
              <small>{LEG_KIND[l.kind]} · {fmtTime(l.reached_at)}</small>
            </span>
            <span className={`c-route-km${l.status !== 'ok' ? ' is-pending' : ''}`}>{l.status === 'ok' ? `+${Number(l.road_km).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km` : (l.status === 'failed' ? 'not measured' : 'measuring…')}</span>
          </li>
        ))}
        {!day.ended_at && <li className="is-open"><span className="c-route-dot" /><span><small>Day not ended yet</small></span></li>}
      </ol>
    </div>
  );
}
