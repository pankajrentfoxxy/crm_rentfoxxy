import React from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { EmptyState } from '../../../components/carret';

/**
 * The picture above a report table (reportsShared.jsx `kind: 'chart'`).
 *
 * Colours are CSS variables, never hex: SVG takes var() in fill/stroke, so a
 * theme switch repaints the chart with no re-render. Series use the four
 * lifecycle families in a fixed order — validated as a categorical set in both
 * themes; --lc-closed (grey) and the alert palette are never a series. A block
 * may pin a colour per row (donut slices that ARE lifecycle states).
 *
 * block: { chart: 'bar'|'hbar'|'line'|'area'|'donut', data, x, series: [{ key, label }],
 *          money?, stacked?, height? }
 */
export const SERIES_COLOURS = ['var(--lc-idle)', 'var(--lc-earning)', 'var(--lc-moving)', 'var(--lc-offcycle)'];
const colourOf = (i) => SERIES_COLOURS[i % SERIES_COLOURS.length];
/** A series may pin its colour (collected = earning, outstanding = moving). */
const seriesColour = (s, i) => s.color || colourOf(i);

const MONEY = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat('en-IN');
export const formatValue = (v, money) => (money ? `₹${MONEY.format(Number(v) || 0)}` : COUNT.format(Number(v) || 0));

/** Axis ticks: ₹12.4L / ₹1.2Cr — the full figure is in the tooltip and the table. */
function compactTick(v, money) {
  const n = Number(v) || 0;
  if (!money) return COUNT.format(n);
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${n}`;
}

const TICK = { fill: 'var(--ink-3)', fontSize: 12, fontFamily: 'var(--font-ui)' };

function Tip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="c-chart-tip">
      {label !== undefined && label !== '' && <div className="c-chart-tip-h">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} className="c-chart-tip-row">
          <span className="c-chart-swatch" style={{ background: p.payload?.color || p.color || p.fill }} aria-hidden="true" />
          <span className="text-ink-2">{p.name}</span>
          <span className="c-chart-tip-v">{formatValue(p.value, money)}</span>
        </div>
      ))}
    </div>
  );
}

/** Legend in HTML, in text ink — the swatch carries identity, not the words. */
function Legend({ items }) {
  return (
    <ul className="c-chart-legend" aria-hidden="true">
      {items.map((it) => (
        <li key={it.label}><span className="c-chart-swatch" style={{ background: it.color }} />{it.label}</li>
      ))}
    </ul>
  );
}

function Donut({ block, height }) {
  const s = block.series[0];
  const rows = block.data.filter((r) => Number(r[s.key]) > 0);
  const total = rows.reduce((t, r) => t + Number(r[s.key]), 0);
  const colour = (r, i) => r.color || colourOf(i);
  return (
    <>
      <div style={{ position: 'relative', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey={s.key}
              nameKey={block.x}
              innerRadius="58%"
              outerRadius="88%"
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {rows.map((r, i) => <Cell key={r[block.x]} fill={colour(r, i)} />)}
            </Pie>
            <Tooltip content={<Tip money={block.money} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="c-chart-centre" aria-hidden="true">
          <strong>{formatValue(total, block.money)}</strong>
          <span>{s.label}</span>
        </div>
      </div>
      <Legend items={rows.map((r, i) => ({ label: `${r[block.x]} · ${formatValue(r[s.key], block.money)}`, color: colour(r, i) }))} />
    </>
  );
}

function Cartesian({ block, height }) {
  const { chart, data, x, series, money, stacked } = block;
  const horizontal = chart === 'hbar';
  const single = series.length === 1;
  const valueAxis = { tick: TICK, tickLine: false, axisLine: false, tickFormatter: (v) => compactTick(v, money), allowDecimals: false };
  const catAxis = { dataKey: x, tick: TICK, tickLine: false, axisLine: { stroke: 'var(--rule-2)' }, interval: 0 };
  const grid = <CartesianGrid stroke="var(--rule)" vertical={horizontal} horizontal={!horizontal} />;
  const tip = <Tooltip content={<Tip money={money} />} cursor={chart === 'line' || chart === 'area' ? { stroke: 'var(--rule-2)' } : { fill: 'var(--surface-3)' }} />;
  const common = { data, margin: { top: 8, right: horizontal ? 96 : 12, bottom: 4, left: 4 } };

  let plot;
  if (chart === 'line' || chart === 'area') {
    const Chart = chart === 'line' ? LineChart : AreaChart;
    plot = (
      <Chart {...common}>
        {grid}
        <XAxis {...catAxis} />
        <YAxis {...valueAxis} width={money ? 64 : 44} />
        {tip}
        {series.map((s, i) => (chart === 'line'
          ? <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={seriesColour(s, i)} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: seriesColour(s, i) }} isAnimationActive={false} />
          : <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={seriesColour(s, i)} strokeWidth={2} fill={seriesColour(s, i)} fillOpacity={0.12} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: seriesColour(s, i) }} isAnimationActive={false} />))}
      </Chart>
    );
  } else {
    const last = series.length - 1;
    plot = (
      <BarChart {...common} layout={horizontal ? 'vertical' : 'horizontal'} barCategoryGap="24%">
        {grid}
        {horizontal ? (
          <>
            <XAxis type="number" {...valueAxis} />
            <YAxis type="category" {...catAxis} width={block.catWidth || 128} />
          </>
        ) : (
          <>
            <XAxis {...catAxis} />
            <YAxis {...valueAxis} width={money ? 64 : 44} />
          </>
        )}
        {tip}
        {series.map((s, i) => {
          // Round only the data end, and only on the outer segment of a stack.
          const round = !stacked || i === last;
          const radius = round ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0;
          return (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={seriesColour(s, i)}
              stackId={stacked ? 'a' : undefined}
              radius={radius}
              stroke="var(--surface)"
              strokeWidth={stacked ? 1 : 0}
              maxBarSize={horizontal ? 22 : 40}
              isAnimationActive={false}
            >
              {single && data.some((r) => r.color) && data.map((r) => <Cell key={r[x]} fill={r.color || colourOf(0)} />)}
              {horizontal && single && (
                <LabelList
                  dataKey={s.labelKey || s.key}
                  position="right"
                  style={{ fill: 'var(--ink-2)', fontSize: 12, fontFamily: 'var(--font-ui)' }}
                  formatter={s.labelKey ? undefined : (v) => formatValue(v, money)}
                />
              )}
            </Bar>
          );
        })}
      </BarChart>
    );
  }

  return (
    <>
      {!single && <Legend items={series.map((s, i) => ({ label: s.label, color: seriesColour(s, i) }))} />}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{plot}</ResponsiveContainer>
      </div>
    </>
  );
}

const KIND_WORD = {
  bar: 'Bar chart', hbar: 'Horizontal bar chart', line: 'Line chart', area: 'Area chart', donut: 'Donut chart',
};

export default function ReportChart({ block }) {
  const data = block.data || [];
  const series = block.series || [];
  const hasValues = data.some((r) => series.some((s) => Number(r[s.key]) > 0));
  if (!hasValues) return <EmptyState title="Nothing to chart in this range" />;

  const rows = block.chart === 'hbar' ? data.length : 0;
  const height = block.height || (rows ? Math.max(160, rows * 34 + 40) : 260);
  const summary = `${KIND_WORD[block.chart] || 'Chart'}: ${block.title}. ${data.length} ${data.length === 1 ? 'point' : 'points'}; `
    + `${series.map((s) => s.label).join(', ')}. The same figures are under Table.`;

  return (
    <figure className="c-chart" aria-label={summary}>
      <figcaption className="sr-only">{summary}</figcaption>
      {block.chart === 'donut'
        ? <Donut block={{ ...block, data, series }} height={height} />
        : <Cartesian block={{ ...block, data, series }} height={height} />}
    </figure>
  );
}
