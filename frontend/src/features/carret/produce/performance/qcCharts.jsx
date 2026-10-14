import React from 'react';
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { COLOUR, dayLabel } from './perfShared';

/**
 * QC inspectors' chart pieces (Floor performance → QC inspectors and the
 * inspector drawer). Status tokens only; every mark also has a word.
 */
const QC_COLOUR = { held: COLOUR.passed, open: COLOUR.awaiting, missed: COLOUR.failed, caught: 'var(--accent)', target: COLOUR.target };

export function QcLegend() {
  return (
    <ul className="c-chart-legend">
      <li><span className="c-chart-swatch" style={{ background: QC_COLOUR.held }} />Passed — held up</li>
      <li><span className="c-chart-swatch" style={{ background: QC_COLOUR.open }} />Passed — still in its window</li>
      <li><span className="c-chart-swatch" style={{ background: QC_COLOUR.missed }} />Passed — missed</li>
      <li><span className="c-chart-swatch" style={{ background: QC_COLOUR.caught }} />Failed — defect caught</li>
      <li><span className="c-chart-swatch" style={{ background: 'transparent', borderTop: `2px dashed ${QC_COLOUR.target}`, height: 0, width: 14 }} />Target</li>
    </ul>
  );
}

function DayTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="c-chart-tip">
      <div className="c-chart-tip-h">{dayLabel(label, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}{r.working ? '' : ' · Sunday'}</div>
      {[['Checks', r.checks], ['QC1 / QC2 / Dispatch QC', `${r.qc1} / ${r.qc2} / ${r.dispatch_qc}`], ['Defects caught (failed)', r.fails_found], ['Passed — missed', r.missed], ['Passed — still in window', r.open], ['Correct', r.correct], ['Target', r.target_line ?? '—']].map(([k, v]) => (
        <div key={k} className="c-chart-tip-row"><span className="text-ink-2">{k}</span><span className="c-chart-tip-v">{v}</span></div>
      ))}
    </div>
  );
}

/** Checks per day: held / open / missed passes and caught fails, with the target line. */
export function QcDailyChart({ days, dailyTarget, height = 240 }) {
  // Chart-only keys: recharts treats some names specially (an `open` key
  // shifted every bar off its day), so the series use their own names.
  const data = days.filter((d) => !d.future).map((d) => ({
    ...d,
    s_held: Math.max(0, d.passed - d.missed - d.open),
    s_window: d.open,
    s_missed: d.missed,
    s_caught: d.fails_found,
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
          <Bar dataKey="s_held" name="Passed — held up" stackId="q" fill={QC_COLOUR.held} stroke="var(--surface)" strokeWidth={1} />
          <Bar dataKey="s_window" name="Passed — in window" stackId="q" fill={QC_COLOUR.open} stroke="var(--surface)" strokeWidth={1} />
          <Bar dataKey="s_missed" name="Passed — missed" stackId="q" fill={QC_COLOUR.missed} stroke="var(--surface)" strokeWidth={1} />
          <Bar dataKey="s_caught" name="Failed — caught" stackId="q" fill={QC_COLOUR.caught} stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
          <Line dataKey="target_line" name="Target" stroke={QC_COLOUR.target} strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

