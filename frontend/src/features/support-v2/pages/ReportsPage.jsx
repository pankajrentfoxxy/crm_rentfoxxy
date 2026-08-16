import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import toast from 'react-hot-toast';
import { BarChart3 } from 'lucide-react';
import { PageHeader, Button, EmptyState } from '../../../components/ui/primitives';
import { Mono } from '../../../components/ui/supportPrimitives';
import { downloadSupportReport, fetchSupportReport } from '../supportV2Api';

const TABS = [
  { id: 'volume', label: 'Volume' },
  { id: 'sla', label: 'SLA' },
  { id: 'quality', label: 'Quality' },
  { id: 'field', label: 'Field' },
  { id: 'assets', label: 'Assets' },
  { id: 'parts', label: 'Parts' },
  { id: 'commercial', label: 'Commercial' },
];

function monthDefault() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = new Date(y, m, 1);
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-01`;
  return { from, to };
}

function BarList({ rows, nameKey, valueKey }) {
  const data = (rows || []).slice(0, 12).map((r) => ({
    name: String(r[nameKey] || '—'),
    value: Number(r[valueKey] || 0),
  }));
  if (!data.length) return <div className="text-[12px] text-sup-muted">No rows in this range.</div>;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" fill="#4F46E5" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="bg-white rounded-xl border border-sup-lineSoft shadow-sup px-3.5 py-3">
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-sup-faint font-semibold">{label}</div>
      <div className="font-mono tabular-nums text-[20px] font-bold tracking-[-0.03em] mt-0.5 text-sup-ink">{value ?? '—'}</div>
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState('volume');
  const [month, setMonth] = useState(monthDefault);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => monthBounds(month), [month]);

  useEffect(() => {
    setLoading(true);
    fetchSupportReport(tab, range)
      .then((r) => setData(r.data))
      .catch((e) => {
        setData(null);
        toast.error(e.response?.data?.message || 'Failed to load report');
      })
      .finally(() => setLoading(false));
  }, [tab, range]);

  async function onExport() {
    try {
      const r = await downloadSupportReport(tab, range);
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `support-${tab}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Export failed');
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      <PageHeader
        title="Reports"
        subtitle="S20 · read-only. Definitions live in supportReportsService.js."
        icon={BarChart3}
        actions={(
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 rounded-lg border border-sup-line px-2 text-[12px]"
            />
            <Button size="sm" onClick={onExport}>Export CSV</Button>
          </div>
        )}
      />

      <div className="flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-9 px-3 rounded-full text-[12px] font-semibold border ${
              tab === t.id ? 'bg-sup-accent text-white border-sup-accent' : 'bg-white text-sup-ink2 border-sup-line'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div className="text-[12.5px] text-sup-muted">Loading report…</div> : null}
      {!loading && !data ? <EmptyState title="Report unavailable" hint="support_reports · view" /> : null}

      {!loading && data && tab === 'volume' ? (
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-sup-lineSoft shadow-sup p-4">
            <div className="text-[13px] font-semibold mb-2">Top issue types</div>
            <BarList rows={data.top_issues} nameKey="issue_label" valueKey="n" />
          </div>
          <div className="bg-white rounded-xl border border-sup-lineSoft shadow-sup p-4 overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-sup-muted text-left">
                <tr><th className="py-1">Channel</th><th>Class</th><th>City</th><th className="text-right">n</th></tr>
              </thead>
              <tbody>
                {(data.rows || []).slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-t border-sup-lineSoft">
                    <td className="py-1">{r.channel}</td>
                    <td>{r.ticket_class}</td>
                    <td>{r.city || '—'}</td>
                    <td className="text-right font-mono">{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && data && tab === 'sla' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Response %" value={data.rows?.[0]?.response_pct} />
            <Kpi label="Resolution %" value={data.rows?.[0]?.resolution_pct} />
            <Kpi label="Avg hours" value={data.rows?.[0]?.avg_hours} />
            <Kpi label="Breaches" value={data.rows?.[0]?.breaches} />
          </div>
          <div className="bg-white rounded-xl border border-sup-lineSoft shadow-sup p-4">
            <div className="text-[13px] font-semibold mb-2">Breaches by reason</div>
            <BarList rows={data.by_reason} nameKey="reason" valueKey="n" />
          </div>
        </div>
      ) : null}

      {!loading && data && tab === 'quality' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Kpi label="FCR %" value={data.rows?.[0]?.fcr_pct} />
            <Kpi label="Reopen %" value={data.rows?.[0]?.reopen_rate} />
            <Kpi label="Reported vs found" value={data.rows?.[0]?.accuracy} />
          </div>
          <div className="bg-white rounded-xl border border-sup-lineSoft shadow-sup p-4">
            <div className="text-[13px] font-semibold mb-2">CSAT ≤ 2</div>
            {(data.csat_low || []).length === 0 ? <div className="text-[12px] text-sup-muted">None.</div> : null}
            {(data.csat_low || []).map((r) => (
              <div key={r.ticket_id} className="flex justify-between text-[12.5px] py-1 border-t border-sup-lineSoft">
                <Mono>{r.ticket_number}</Mono>
                <span>CSAT {r.csat_score}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && data && ['field', 'assets', 'parts', 'commercial'].includes(tab) ? (
        <div className="bg-white rounded-xl border border-sup-lineSoft shadow-sup overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-sup-canvas text-sup-muted text-left">
              <tr>
                {Object.keys((data.rows && data.rows[0]) || { empty: '' }).map((k) => (
                  <th key={k} className="px-3 py-2">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.rows || []).map((r, i) => (
                <tr key={i} className="border-t border-sup-lineSoft">
                  {Object.values(r).map((v, j) => (
                    <td key={j} className="px-3 py-2 font-mono tabular-nums">{v == null ? '—' : String(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {tab === 'assets' && data.tco ? (
            <div className="p-4 border-t border-sup-lineSoft">
              <div className="text-[13px] font-semibold mb-2">TCO per TTSPL (parts)</div>
              <BarList rows={data.tco} nameKey="ttspl_id" valueKey="parts_cost" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
