import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import { Button, EmptyState, Section } from '../../../components/carret';
import { TASK_KINDS, fetchFieldTeam, fmtKm, periodRange } from './fieldApi';
import { DayChart, KindLegend, KindTiles, PeriodPicker, TaskList, TravelDay } from './fieldShared';

/**
 * Support → Field technicians (17 Oct 2026, section field_travel): every
 * technician's tasks (visits, pickups, deliveries, vendor hand-overs) and km
 * travelled by road, for a day or any period. Open one to see their route day
 * by day and every task.
 */
export default function FieldTeamPage() {
  const [period, setPeriod] = useState('today');
  const [custom, setCustom] = useState({});
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const { from, to } = periodRange(period, custom);
  useEffect(() => {
    setData(null);
    fetchFieldTeam({ from, to }).then(({ data: d }) => setData(d))
      .catch((e) => { toast.error(e?.response?.data?.message || 'Could not load'); setData({ technicians: [] }); });
  }, [from, to]);
  const techs = data?.technicians || [];
  const totals = techs.reduce((s, t) => {
    TASK_KINDS.forEach((k) => { s.counts[k.key] = (s.counts[k.key] || 0) + (t.counts[k.key] || 0); });
    s.total += t.total; s.km += t.km;
    return s;
  }, { counts: {}, total: 0, km: 0 });
  const maxKm = Math.max(1, ...techs.map((t) => t.km));
  const sel = techs.find((t) => t.user_id === open);
  return (
    <DeskShell title="Field technicians" breadcrumb="Support" subtitle="Tasks done and km travelled by road, per technician.">
      <div className="c-stack">
        <PeriodPicker period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
        {!data ? <EmptyState title="Loading…" /> : (
          <>
            <KindTiles counts={totals.counts} total={totals.total} km={Math.round(totals.km * 10) / 10} />
            <Section title={`Technicians · ${techs.length}`} actions={<KindLegend />}>
              {!techs.length ? <EmptyState title="Nothing in this period" body="Technicians appear once they check in or finish a task." /> : (
                <div className="c-fteam">
                  {techs.map((t) => (
                    <button key={t.user_id} type="button" className={`c-fteam-row${open === t.user_id ? ' is-on' : ''}`} onClick={() => setOpen(open === t.user_id ? null : t.user_id)}>
                      <span className="c-fteam-n"><b>{t.name}</b><small>{t.days_worked} day{t.days_worked === 1 ? '' : 's'}</small></span>
                      <span className="c-fteam-bar" aria-hidden="true">
                        {TASK_KINDS.map((k) => (t.counts[k.key] ? <i key={k.key} style={{ flex: t.counts[k.key], background: k.color }} title={`${k.label}: ${t.counts[k.key]}`} /> : null))}
                      </span>
                      <span className="c-fteam-c">
                        {TASK_KINDS.filter((k) => t.counts[k.key]).map((k) => <em key={k.key} style={{ color: k.color }}>{t.counts[k.key]} {k.short.toLowerCase()}</em>)}
                        {!t.total && <em className="text-ink-3">no tasks</em>}
                      </span>
                      <span className="c-fteam-km"><b>{fmtKm(t.km)}</b><i style={{ width: `${(t.km / maxKm) * 100}%` }} /></span>
                    </button>
                  ))}
                </div>
              )}
            </Section>
            {sel && (
              <Section title={sel.name} actions={<Button variant="quiet" onClick={() => setOpen(null)}>Close</Button>}>
                <div className="c-stack">
                  <KindTiles counts={sel.counts} total={sel.total} km={sel.km} />
                  <DayChart series={sel.series} />
                  {sel.travel.map((d) => <TravelDay key={d.day_id} day={d} />)}
                  <TaskList tasks={sel.tasks} />
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </DeskShell>
  );
}
