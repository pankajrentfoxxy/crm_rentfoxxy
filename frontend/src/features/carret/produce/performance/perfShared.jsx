import React from 'react';
import {
  Bar, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import api from '../../../../utils/api';
import { StatusChip } from '../../../../components/carret';

/**
 * Production → Technician performance: shared bits.
 *
 * Colours are the app's status tokens, never a generated palette: QC passed =
 * --alert-good, QC failed = --alert-crit, awaiting QC = neutral rule grey.
 * Every mark also has a word (legend, tooltip, table), so colour is never the
 * only signal.
 */
export const fetchPerformance = (params) => api.get('/technician-performance', { params });
export const fetchTechnician = (userId, params) => api.get(`/technician-performance/technician/${userId}`, { params });
export const fetchTargets = () => api.get('/technician-performance/targets');
export const saveTargets = (body) => api.put('/technician-performance/targets', body);
// QC inspectors (migration 423).
export const fetchQcPerformance = (params) => api.get('/qc-performance', { params });
export const fetchQcInspector = (userId, params) => api.get(`/qc-performance/inspector/${userId}`, { params });
export const fetchQcTargets = () => api.get('/qc-performance/targets');
export const saveQcTargets = (body) => api.put('/qc-performance/targets', body);

/** "Target 25/day", "(own)", or "No target" for someone outside the job's roles. */
export const targetText = (p) => (p.daily_target ? `Target ${p.daily_target}/day${p.own_target ? ' (own)' : ''}` : 'No target');

export const COLOUR = {
  passed: 'var(--alert-good)',
  failed: 'var(--alert-crit)',
  awaiting: 'var(--rule-2)',
  target: 'var(--ink-2)',
};

/* ── periods (IST calendar days) ─────────────────────────────────────── */
export const istToday = () => new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
const d0 = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = d0(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };

export const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'custom', label: 'Custom' },
];

/** The [from, to] a period covers around `anchor`. Weeks run Mon–Sun. */
export function periodRange(kind, anchor) {
  if (kind === 'week') {
    const dow = (d0(anchor).getUTCDay() + 6) % 7; // Mon = 0
    const from = addDays(anchor, -dow);
    return { from, to: addDays(from, 6) };
  }
  if (kind === 'month') {
    const d = d0(anchor);
    const from = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    const to = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    return { from, to };
  }
  return { from: anchor, to: anchor };
}

/** Move the anchor one period back (-1) or forward (+1). */
export function stepAnchor(kind, anchor, dir) {
  if (kind === 'week') return addDays(anchor, 7 * dir);
  if (kind === 'month') {
    const d = d0(anchor);
    return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)));
  }
  return addDays(anchor, dir);
}

const DAY_FMT = { day: 'numeric', month: 'short', timeZone: 'UTC' };
export const dayLabel = (s, opts = DAY_FMT) => d0(s).toLocaleDateString('en-IN', opts);
export function periodTitle(kind, from, to) {
  if (kind === 'day') return d0(from).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (kind === 'month') return d0(from).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${dayLabel(from)} – ${dayLabel(to, { ...DAY_FMT, year: 'numeric' })}`;
}

/* ── small pieces ────────────────────────────────────────────────────── */
const QC_CHIP = {
  passed: { chip: 'completed', label: 'QC passed' },
  failed: { chip: 'rejected', label: 'QC failed' },
  awaiting: { chip: 'pending', label: 'Awaiting QC' },
};
export function QcChip({ qc, sub }) {
  const c = QC_CHIP[qc] || QC_CHIP.awaiting;
  return <StatusChip status={c.chip} label={sub ? `${c.label} · ${sub}` : c.label} />;
}

/** Correct jobs against target: a bar with a tick at the target. */
export function TargetMeter({ correct, failed = 0, awaiting = 0, target }) {
  const max = Math.max(target, correct + failed, 1);
  const pct = (n) => `${Math.min(100, (n / max) * 100)}%`;
  const passedOnly = Math.max(0, correct - awaiting);
  return (
    <div className="c-meter" role="img" aria-label={`${correct} correct of a target of ${target}; ${failed} failed QC; ${awaiting} awaiting QC`}>
      <div className="c-meter-track">
        <span style={{ width: pct(passedOnly), background: COLOUR.passed }} />
        <span style={{ width: pct(awaiting), background: COLOUR.awaiting }} />
        <span style={{ width: pct(failed), background: COLOUR.failed }} />
      </div>
      {target > 0 && <i className="c-meter-target" style={{ left: pct(target) }} title={`Target ${target}`} />}
    </div>
  );
}

export function Standing({ s, eligible, provisional }) {
  const tone = s?.key === 'above' || s?.key === 'on' ? 'good' : s?.key === 'below' ? 'bad' : '';
  return (
    <span className={`c-standing${tone ? ` is-${tone}` : ''}`}>
      <span aria-hidden="true">{s?.key === 'above' ? '▲' : s?.key === 'below' ? '▼' : '●'}</span>
      {s?.label || '—'}
      {eligible && <small>{provisional ? 'Incentive — provisional' : 'Incentive earned'}</small>}
    </span>
  );
}

export function Legend() {
  return (
    <ul className="c-chart-legend">
      <li><span className="c-chart-swatch" style={{ background: COLOUR.passed }} />QC passed</li>
      <li><span className="c-chart-swatch" style={{ background: COLOUR.awaiting }} />Awaiting QC</li>
      <li><span className="c-chart-swatch" style={{ background: COLOUR.failed }} />QC failed</li>
      <li><span className="c-chart-swatch" style={{ background: 'transparent', borderTop: `2px dashed ${COLOUR.target}`, height: 0, width: 14 }} />Target</li>
    </ul>
  );
}

function DayTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="c-chart-tip">
      <div className="c-chart-tip-h">{dayLabel(label, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}{r.working ? '' : ' · Sunday'}</div>
      {[['Jobs done', r.completed], ['QC passed', r.passed], ['Awaiting QC', r.awaiting], ['QC failed', r.failed], ['Correct', r.correct], ['Target', r.target_line ?? '—'], ['Reworks (not counted)', r.reworks]].map(([k, v]) => (
        <div key={k} className="c-chart-tip-row"><span className="text-ink-2">{k}</span><span className="c-chart-tip-v">{v}</span></div>
      ))}
    </div>
  );
}

/**
 * Jobs per day, stacked by QC result, with the day's target as a dashed line.
 * One count axis. Hover a day for every figure.
 */
export function DailyChart({ days, dailyTarget, height = 240 }) {
  const data = days.filter((d) => !d.future).map((d) => ({
    ...d,
    passed_only: d.passed,
    target_line: d.working && dailyTarget ? dailyTarget : null,
  }));
  if (!data.length) return null;
  const TICK = { fill: 'var(--ink-3)', fontSize: 12, fontFamily: 'var(--font-ui)' };
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--rule)" />
          <XAxis dataKey="day" tick={TICK} tickLine={false} axisLine={{ stroke: 'var(--rule-2)' }} tickFormatter={(d) => dayLabel(d)} minTickGap={8} />
          <YAxis allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<DayTip />} cursor={{ fill: 'var(--accent-soft)' }} />
          <Bar dataKey="passed_only" name="QC passed" stackId="j" fill={COLOUR.passed} stroke="var(--surface)" strokeWidth={1} />
          <Bar dataKey="awaiting" name="Awaiting QC" stackId="j" fill={COLOUR.awaiting} stroke="var(--surface)" strokeWidth={1} />
          <Bar dataKey="failed" name="QC failed" stackId="j" fill={COLOUR.failed} stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
          <Line dataKey="target_line" name="Target" stroke={COLOUR.target} strokeDasharray="5 4" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
