import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, ArrowDownToLine, Boxes, Laptop, Loader2,
  PackageCheck, RefreshCw, TrendingUp, Wallet,
} from 'lucide-react';
import { fetchPartsDashboard } from '../partTrackingApi';
import { partCategoryLabel } from '../../../constants/laptopConditions';
import PartsDrilldownPanel from '../components/PartsDrilldownPanel';
import PartsExportButton from '../components/PartsExportButton';

const EMPTY_ARR = [];
const EMPTY_OBJ = {};

const CATEGORY_COLORS = [
  '#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c',
  '#65a30d', '#0891b2', '#c026d3', '#dc2626', '#64748b',
];

function isoDate(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

const RANGE_PRESETS = [
  { id: 'today', label: 'Today', from: () => isoDate(new Date()), to: () => isoDate(new Date()) },
  { id: '7d', label: 'Last 7 days', from: () => daysAgo(6), to: () => isoDate(new Date()) },
  { id: '30d', label: 'Last 30 days', from: () => daysAgo(29), to: () => isoDate(new Date()) },
  { id: '90d', label: 'Last 90 days', from: () => daysAgo(89), to: () => isoDate(new Date()) },
];

function money(n) {
  const v = Number(n) || 0;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function shortDay(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** KPI tile. The whole tile is the drill-down affordance. */
function KpiCard({ label, value, sublabel, icon: Icon, tone = 'teal', onClick, disabled }) {
  const tones = {
    teal: 'bg-teal-50 text-teal-700 ring-teal-100',
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  };
  const interactive = Boolean(onClick) && !disabled;
  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      className={`text-left w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all
        ${interactive ? 'hover:border-slate-300 hover:shadow-md cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 m-0">{label}</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1 m-0">{value}</p>
          {sublabel ? <p className="text-[11px] text-slate-400 mt-1 m-0">{sublabel}</p> : null}
        </div>
        <span className={`shrink-0 grid place-items-center w-10 h-10 rounded-xl ring-1 ${tones[tone] || tones.teal}`}>
          <Icon className="w-5 h-5" />
        </span>
      </div>
      {interactive ? (
        <p className="text-[11px] text-slate-400 mt-2.5 m-0">Click to see the units →</p>
      ) : null}
    </button>
  );
}

function Panel({ title, subtitle, children, action }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 m-0">{title}</h2>
          {subtitle ? <p className="text-xs text-slate-500 mt-0.5 m-0">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Number that opens the drill-down; renders as plain text when it is zero. */
function DrillNumber({ value, onClick, className = '' }) {
  const n = Number(value) || 0;
  if (!n) return <span className="text-slate-300 tabular-nums">0</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-semibold tabular-nums text-blue-700 hover:text-blue-900 hover:underline ${className}`}
    >
      {n}
    </button>
  );
}

export default function PartsDashboardPage() {
  const [preset, setPreset] = useState('30d');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoDate(new Date()));
  const [category, setCategory] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drilldown, setDrilldown] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await fetchPartsDashboard({ from, to, category: category || undefined });
      setData(res);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not load the parts dashboard');
    } finally {
      setLoading(false);
    }
  }, [from, to, category]);

  useEffect(() => { load(); }, [load]);

  function applyPreset(p) {
    setPreset(p.id);
    setFrom(p.from());
    setTo(p.to());
  }

  const openDrilldown = useCallback((extra) => {
    setDrilldown({ from, to, category: category || undefined, ...extra });
  }, [from, to, category]);

  const totals = data?.totals || EMPTY_OBJ;
  const byCategory = data?.by_category || EMPTY_ARR;
  const stock = data?.stock_by_category || EMPTY_ARR;
  const topParts = data?.top_parts || EMPTY_ARR;
  const recent = data?.recent || EMPTY_ARR;

  const stockTotals = useMemo(() => stock.reduce((acc, s) => ({
    in_stock: acc.in_stock + s.in_stock,
    reserved: acc.reserved + s.reserved,
    defective: acc.defective + s.defective,
    value: acc.value + s.stock_value,
  }), { in_stock: 0, reserved: 0, defective: 0, value: 0 }), [stock]);

  const chartData = useMemo(
    () => (data?.series || EMPTY_ARR).map((s) => ({ ...s, label: shortDay(s.day) })),
    [data]
  );

  const stockPie = useMemo(
    () => stock.filter((s) => s.in_stock > 0).map((s) => ({
      name: partCategoryLabel(s.category),
      value: s.in_stock,
      category: s.category,
    })),
    [stock]
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2 m-0">
            <Boxes className="w-6 h-6 text-teal-600" />
            Parts Tracking Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-1 m-0">
            What came in, what went into laptops, and what came back — every number opens the units behind it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PartsExportButton
            params={{ from, to, category: category || undefined }}
            sheet="all"
            label="Export all"
            filename={`parts_dashboard_all_${from}_to_${to}.xlsx`}
          />
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px]"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-1.5">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                preset === p.id
                  ? 'border-teal-600 bg-teal-600 text-white'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1" htmlFor="parts-from">From</label>
            <input
              id="parts-from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1" htmlFor="parts-to">To</label>
            <input
              id="parts-to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => { setTo(e.target.value); setPreset('custom'); }}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1" htmlFor="parts-category">Category</label>
          <select
            id="parts-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white min-w-[10rem]"
          >
            <option value="">All categories</option>
            {byCategory.map((c) => (
              <option key={c.category} value={c.category}>{partCategoryLabel(c.category)}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading parts activity…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Received"
              value={totals.received || 0}
              sublabel={`${money(totals.value_received)} of stock taken in`}
              icon={ArrowDownToLine}
              tone="teal"
              onClick={() => openDrilldown({ metric: 'received' })}
            />
            <KpiCard
              label="Installed on laptops"
              value={totals.installed || 0}
              sublabel={`${totals.laptops_touched || 0} laptop${totals.laptops_touched === 1 ? '' : 's'} · ${money(totals.value_installed)}`}
              icon={PackageCheck}
              tone="blue"
              onClick={() => openDrilldown({ metric: 'installed' })}
            />
            <KpiCard
              label="Defective returned"
              value={totals.returned_defective || 0}
              sublabel="Taken back into inventory with their own Part ID"
              icon={AlertTriangle}
              tone="rose"
              onClick={() => openDrilldown({ metric: 'returned_defective' })}
            />
            <KpiCard
              label="Stock on hand"
              value={stockTotals.in_stock}
              sublabel={`${stockTotals.reserved} reserved · ${stockTotals.defective} defective · ${money(stockTotals.value)}`}
              icon={Wallet}
              tone="slate"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Upgrades"
              value={totals.installed_upgrade || 0}
              sublabel="RAM, storage and spec changes"
              icon={TrendingUp}
              tone="violet"
              onClick={() => openDrilldown({ metric: 'installed_upgrade' })}
            />
            <KpiCard
              label="Replacements"
              value={totals.installed_replacement || 0}
              sublabel="Swapped for a faulty part"
              icon={Laptop}
              tone="amber"
              onClick={() => openDrilldown({ metric: 'installed_replacement' })}
            />
            <KpiCard
              label="Reusable returned"
              value={totals.returned_good || 0}
              sublabel="Back into sellable stock"
              icon={ArrowDownToLine}
              tone="teal"
              onClick={() => openDrilldown({ metric: 'returned_good' })}
            />
            <KpiCard
              label="Written off"
              value={totals.discarded || 0}
              sublabel="Scrapped units"
              icon={AlertTriangle}
              tone="slate"
              onClick={() => openDrilldown({ metric: 'discarded' })}
            />
          </div>

          <Panel
            title="Day by day"
            subtitle="Received versus used, with defective returns. Click a bar to see that day's units."
            action={(
              <PartsExportButton
                compact
                params={{ from, to, category: category || undefined }}
                sheet="daily"
                label="Export"
                filename={`parts_daily_${from}_to_${to}.xlsx`}
              />
            )}
          >
            {chartData.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-16 m-0">No movements in this range.</p>
            ) : (
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: '#f1f5f9' }}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="received" name="Received" fill="#0d9488" radius={[4, 4, 0, 0]} cursor="pointer"
                      onClick={(d) => d?.payload && openDrilldown({ metric: 'received', day: d.payload.day })}
                    />
                    <Bar
                      dataKey="installed" name="Installed" fill="#2563eb" radius={[4, 4, 0, 0]} cursor="pointer"
                      onClick={(d) => d?.payload && openDrilldown({ metric: 'installed', day: d.payload.day })}
                    />
                    <Bar
                      dataKey="returned_defective" name="Defective back" fill="#e11d48" radius={[4, 4, 0, 0]} cursor="pointer"
                      onClick={(d) => d?.payload && openDrilldown({ metric: 'returned_defective', day: d.payload.day })}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Panel
                title="By category"
                subtitle="Every count opens the units behind it."
                action={(
                  <PartsExportButton
                    compact
                    params={{ from, to, category: category || undefined }}
                    sheet="category"
                    label="Export"
                    filename={`parts_by_category_${from}_to_${to}.xlsx`}
                  />
                )}
              >
                {byCategory.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12 m-0">No movements in this range.</p>
                ) : (
                  <div className="overflow-x-auto -mx-5 px-5">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
                          <th className="py-2 font-semibold">Category</th>
                          <th className="py-2 font-semibold text-right">Received</th>
                          <th className="py-2 font-semibold text-right">Installed</th>
                          <th className="py-2 font-semibold text-right">Upgrade</th>
                          <th className="py-2 font-semibold text-right">Replace</th>
                          <th className="py-2 font-semibold text-right">Defective</th>
                          <th className="py-2 font-semibold text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {byCategory.map((c) => (
                          <tr key={c.category} className="hover:bg-slate-50/70">
                            <td className="py-2.5 font-medium text-slate-800">{partCategoryLabel(c.category)}</td>
                            <td className="py-2.5 text-right">
                              <DrillNumber value={c.received} onClick={() => openDrilldown({ metric: 'received', category: c.category })} />
                            </td>
                            <td className="py-2.5 text-right">
                              <DrillNumber value={c.installed} onClick={() => openDrilldown({ metric: 'installed', category: c.category })} />
                            </td>
                            <td className="py-2.5 text-right">
                              <DrillNumber value={c.upgrade} onClick={() => openDrilldown({ metric: 'installed_upgrade', category: c.category })} />
                            </td>
                            <td className="py-2.5 text-right">
                              <DrillNumber value={c.replacement} onClick={() => openDrilldown({ metric: 'installed_replacement', category: c.category })} />
                            </td>
                            <td className="py-2.5 text-right">
                              <DrillNumber value={c.returned_defective} onClick={() => openDrilldown({ metric: 'returned_defective', category: c.category })} />
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-slate-600">{money(c.value_installed)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>

            <div className="lg:col-span-2">
              <Panel
                title="Stock on hand"
                subtitle="Available units right now, by category."
                action={(
                  <PartsExportButton
                    compact
                    params={{ from, to, category: category || undefined }}
                    sheet="stock"
                    label="Export"
                    filename={`parts_stock_${from}_to_${to}.xlsx`}
                  />
                )}
              >
                {stockPie.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12 m-0">No stocked units.</p>
                ) : (
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={stockPie}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={2}
                        >
                          {stockPie.map((entry, i) => (
                            <Cell key={entry.category} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Most used parts"
              subtitle="Highest install count in this range."
              action={(
                <PartsExportButton
                  compact
                  params={{ from, to, category: category || undefined }}
                  sheet="top_parts"
                  label="Export"
                  filename={`parts_most_used_${from}_to_${to}.xlsx`}
                />
              )}
            >
              {topParts.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10 m-0">Nothing installed in this range.</p>
              ) : (
                <ul className="space-y-2 m-0 p-0 list-none">
                  {topParts.map((p) => {
                    const max = topParts[0].installed || 1;
                    return (
                      <li key={`${p.part_id}-${p.part_name}`} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm text-slate-800 truncate m-0">{p.part_name}</p>
                            <span className="text-xs text-slate-400 shrink-0">{money(p.value_installed)}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${Math.max(4, (p.installed / max) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <DrillNumber
                          value={p.installed}
                          className="w-8 text-right"
                          onClick={() => openDrilldown({ metric: 'installed', part_id: p.part_id })}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              title="Latest activity"
              subtitle="The 25 most recent part movements."
              action={(
                <PartsExportButton
                  compact
                  params={{ from, to, category: category || undefined }}
                  sheet="recent"
                  label="Export"
                  filename={`parts_latest_${from}_to_${to}.xlsx`}
                />
              )}
            >
              {recent.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10 m-0">Nothing recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-50 m-0 p-0 list-none max-h-80 overflow-y-auto">
                  {recent.map((r, i) => (
                    <li key={`${r.prt_id}-${r.occurred_at}-${i}`} className="py-2 flex items-start gap-2.5">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                        r.movement_type === 'installed' ? 'bg-blue-500'
                          : r.movement_type === 'received' ? 'bg-teal-500'
                          : r.movement_type === 'returned_defective' ? 'bg-rose-500'
                          : 'bg-slate-300'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800 m-0 truncate">
                          <span className="font-mono text-xs text-slate-500">{r.prt_id}</span>
                          {' · '}{r.part_name}
                        </p>
                        <p className="text-[11px] text-slate-400 m-0">
                          {r.movement_type.replace(/_/g, ' ')}
                          {r.ttspl_id ? ` → ${r.ttspl_id}` : ''}
                          {r.actor_name ? ` · ${r.actor_name}` : ''}
                          {' · '}{shortDay(r.occurred_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}

      <PartsDrilldownPanel query={drilldown} onClose={() => setDrilldown(null)} />
    </div>
  );
}
