import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import { EmptyState, Section } from '../../../components/carret';
import { TECH_TABS } from '../serve/serveShared';
import { fetchMyReport, periodRange } from './fieldApi';
import { DayChart, KindLegend, KindTiles, PeriodPicker, TaskList, TravelDay } from './fieldShared';

/**
 * Field → My report (17 Oct 2026): what I did — complaint visits, return and
 * repair pickups, deliveries, vendor hand-overs — today, this week, this
 * month or any dates, with the km I travelled by road each day.
 */
export default function MyReportPage() {
  const [period, setPeriod] = useState('today');
  const [custom, setCustom] = useState({});
  const [data, setData] = useState(null);
  const { from, to } = periodRange(period, custom);
  useEffect(() => {
    setData(null);
    fetchMyReport({ from, to }).then(({ data: d }) => setData(d))
      .catch((e) => { toast.error(e?.response?.data?.message || 'Could not load your report'); setData({ tasks: [], travel: [], counts: {} }); });
  }, [from, to]);
  return (
    <FieldShell title="My report" tabs={TECH_TABS}>
      <div className="c-stack">
        <PeriodPicker period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
        {!data ? <EmptyState title="Loading…" /> : (
          <>
            <KindTiles counts={data.counts} total={data.total} km={data.km} />
            {(data.series || []).length > 1 && (
              <Section title="Day by day">
                <DayChart series={data.series} />
                <KindLegend />
              </Section>
            )}
            {(data.travel || []).length > 0 && (
              <Section title={`Travel · ${(data.travel || []).length} day${data.travel.length > 1 ? 's' : ''}`}>
                {data.travel.map((d) => <TravelDay key={d.day_id} day={d} />)}
              </Section>
            )}
            <Section title={`Tasks · ${data.total || 0}`}><TaskList tasks={data.tasks} /></Section>
          </>
        )}
      </div>
    </FieldShell>
  );
}
