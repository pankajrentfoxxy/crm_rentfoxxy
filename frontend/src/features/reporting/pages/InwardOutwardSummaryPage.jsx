import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ArrowDownToLine, ArrowUpFromLine, Building2, Users, Truck, Package } from 'lucide-react';
import api from '../../../utils/api';

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const DATE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'custom', label: 'Custom' },
];

const rangeForPreset = (preset) => {
  if (preset === 'today') return { from: today(), to: today() };
  if (preset === 'yesterday') return { from: yesterday(), to: yesterday() };
  return { from: '', to: '' };
};

const paramsForFilters = (f) => {
  const base = { customer: f.customer, vendor: f.vendor };
  if (f.preset === 'all') return { ...base, all_time: 1 };
  if (f.from && f.to) return { ...base, from: f.from, to: f.to };
  return { ...base, all_time: 1 };
};

function KpiCard({ title, value, subtitle, icon: Icon, accent = 'blue', big = false }) {
  const colors = {
    blue: 'text-blue-600 bg-blue-100',
    green: 'text-green-600 bg-green-100',
    amber: 'text-amber-600 bg-amber-100',
    purple: 'text-purple-600 bg-purple-100',
    slate: 'text-slate-700 bg-slate-100',
  };
  const c = colors[accent] || colors.blue;
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{title}</p>
          <p className={`${big ? 'text-3xl' : 'text-2xl'} font-bold mt-1 ${c.split(' ')[0]}`}>{value ?? 0}</p>
          {subtitle ? <p className="text-xs text-gray-400 mt-1">{subtitle}</p> : null}
        </div>
        {Icon ? (
          <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${c}`}>
            <Icon className="w-5 h-5" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const DEFAULT_FILTERS = { preset: 'all', from: '', to: '', customer: '', vendor: '' };

export default function InwardOutwardSummaryPage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [options, setOptions] = useState({ vendors: [], customers: [] });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const setPreset = (preset) => {
    setFilters((f) => ({ ...f, preset, ...(preset === 'custom' ? {} : rangeForPreset(preset)) }));
  };

  const setDate = (key, value) => {
    setFilters((f) => ({ ...f, preset: 'custom', [key]: value }));
  };

  useEffect(() => {
    api.get('/reports/inward-outward-summary/filters')
      .then((r) => setOptions({
        vendors: r.data.vendors || [],
        customers: r.data.customers || [],
      }))
      .catch(() => {});
  }, []);

  const load = useCallback(async (f) => {
    setLoading(true);
    try {
      const res = await api.get('/reports/inward-outward-summary', { params: paramsForFilters(f) });
      setSummary(res.data.summary || null);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [filters, load]);

  const reset = () => setFilters(DEFAULT_FILTERS);

  const inward = summary?.inward;
  const outward = summary?.outward;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Inward &amp; Outward Summary</h1>
        <p className="text-sm text-gray-500 mt-1">Laptop movement — received into and dispatched from the warehouse</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                filters.preset === p.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">From</span>
            <input type="date" value={filters.from} onChange={(e) => setDate('from', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">To</span>
            <input type="date" value={filters.to} onChange={(e) => setDate('to', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">Customer</span>
            <select value={filters.customer} onChange={(e) => set('customer', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[160px] max-w-[220px]">
              <option value="">All customers</option>
              {options.customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">Vendor</span>
            <select value={filters.vendor} onChange={(e) => set('vendor', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[150px] max-w-[220px]">
              <option value="">All vendors</option>
              {options.vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.business_name}</option>)}
            </select>
          </label>
          <button type="button" onClick={reset}
            className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Clear</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" /></div>
      ) : (
        <>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ArrowDownToLine className="w-5 h-5 text-green-600" />
              <h2 className="text-sm font-semibold text-gray-900">Inward Summary</h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Total Inward Laptops" value={inward?.total} icon={ArrowDownToLine} accent="green" big />
              <KpiCard title="Inward from Vendor" value={inward?.vendor} subtitle="GRN / Purchase" icon={Building2} accent="blue" />
              <KpiCard title="Inward from Customer" value={inward?.customer} subtitle="Support pickup / repair / return" icon={Users} accent="amber" />
              <KpiCard title="Direct Inward" value={inward?.direct} subtitle="Courier / Bluedart / Manual" icon={Truck} accent="purple" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <ArrowUpFromLine className="w-5 h-5 text-red-600" />
              <h2 className="text-sm font-semibold text-gray-900">Outward Summary</h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Total Outward Laptops" value={outward?.total} icon={ArrowUpFromLine} accent="slate" big />
              <KpiCard title="Outward to Customer" value={outward?.customer} subtitle="Delivery challan dispatch" icon={Package} accent="blue" />
              <KpiCard title="Outward to Vendor" value={outward?.vendor} subtitle="Vendor / purchase return" icon={Building2} accent="amber" />
            </div>
          </div>

          <p className="text-[11px] text-gray-400">
            Inward counts use each source&apos;s receipt date (vendor GRN, warehouse-received pickups, inward ledger).
            Outward counts use the dispatch date on delivery challans and vendor repair DCs.
            The Vendor and Customer filters scope results to the matching movement type.
          </p>
        </>
      )}
    </div>
  );
}
