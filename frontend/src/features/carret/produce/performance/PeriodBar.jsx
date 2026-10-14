import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input, Segmented } from '../../../../components/carret';
import {
  PERIODS, istToday, periodRange, periodTitle, stepAnchor,
} from './perfShared';

/**
 * The period picked in the URL (?period=day|week|month|custom, ?date=, or
 * ?from=&to=), shared by Floor performance and My performance.
 */
export function usePeriodParams() {
  const [params, setParams] = useSearchParams();
  const kind = PERIODS.some((p) => p.value === params.get('period')) ? params.get('period') : 'day';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : istToday();
  const custom = { from: params.get('from') || anchor, to: params.get('to') || anchor };
  const { from, to } = kind === 'custom' ? custom : periodRange(kind, anchor);
  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  return { kind, anchor, from, to, params, set, isFuture: from > istToday() };
}

/** Day / week / month / custom, with previous / next and a date. */
export default function PeriodBar({ period }) {
  const { kind, anchor, from, to, set } = period;
  return (
    <div className="c-perf-bar">
      <Segmented label="Period" value={kind} onChange={(v) => set({ period: v, from: v === 'custom' ? from : '', to: v === 'custom' ? to : '' })} options={PERIODS} />
      {kind !== 'custom' ? (
        <div className="c-perf-nav">
          <Button variant="quiet" aria-label="Previous" onClick={() => set({ date: stepAnchor(kind, anchor, -1) })}>‹</Button>
          <span className="c-perf-title">{periodTitle(kind, from, to)}</span>
          <Button variant="quiet" aria-label="Next" disabled={to >= istToday()} onClick={() => set({ date: stepAnchor(kind, anchor, 1) })}>›</Button>
          <Input type="date" value={anchor} max={istToday()} onChange={(e) => e.target.value && set({ date: e.target.value })} aria-label="Pick a date" style={{ maxWidth: '10rem' }} />
          {anchor !== istToday() && <Button variant="quiet" onClick={() => set({ date: '' })}>Today</Button>}
        </div>
      ) : (
        <div className="c-perf-nav">
          <Input type="date" value={from} max={istToday()} onChange={(e) => e.target.value && set({ from: e.target.value })} aria-label="From" style={{ maxWidth: '10rem' }} />
          <span className="text-ink-3">to</span>
          <Input type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} aria-label="To" style={{ maxWidth: '10rem' }} />
        </div>
      )}
    </div>
  );
}
