import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Loader2, PlugZap, RefreshCw, Search } from 'lucide-react';
import ScanField from '../../../components/ScanField';
import {
  approveChargerHandover,
  fetchAvailableChargers,
  fetchChargerWarehouseQueue,
} from '../../dispatch-charger/dispatchChargerApi';

const TABS = [
  { id: 'pending', label: 'Pending handover' },
  { id: 'handed_over', label: 'Handed over' },
  { id: 'attached', label: 'Attached' },
  { id: 'all', label: 'All' },
];

function kitRoleOf(unit) {
  const name = String(unit?.part_name || '').toLowerCase();
  return /(cable|cord)/.test(name) ? 'cable' : 'adapter';
}

function laptopSpec(row) {
  const brand = String(row?.brand || '').trim();
  const model = String(row?.model || '').trim();
  return [brand, model].filter(Boolean).join(' ') || '—';
}

function formatWhen(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isSameIstDay(value, ymd) {
  if (!value || !ymd) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts === ymd;
}

function todayIst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function DispatchChargerQueuePage() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);
  const [adapterScan, setAdapterScan] = useState('');
  const [cableScan, setCableScan] = useState('');
  const [adapterUnit, setAdapterUnit] = useState(null);
  const [cableUnit, setCableUnit] = useState(null);
  const [stock, setStock] = useState([]);
  const [stockQ, setStockQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [dayFilter, setDayFilter] = useState(todayIst);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchChargerWarehouseQueue(tab);
      setRows(data.data || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load charger queue');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const loadStock = useCallback(async (q) => {
    try {
      const [adaptersRes, cablesRes] = await Promise.all([
        fetchAvailableChargers(q, { role: 'adapter', limit: 80 }),
        fetchAvailableChargers(q, { role: 'cable', limit: 80 }),
      ]);
      const adapters = adaptersRes.data?.data || [];
      const cables = cablesRes.data?.data || [];
      setStock([...adapters, ...cables]);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load charger stock');
    }
  }, []);

  useEffect(() => {
    if (active) loadStock(stockQ);
  }, [active, stockQ, loadStock]);

  const resetKit = () => {
    setAdapterScan('');
    setCableScan('');
    setAdapterUnit(null);
    setCableUnit(null);
  };

  const pickUnit = (unit) => {
    const role = unit.kit_role || kitRoleOf(unit);
    if (role === 'cable') {
      setCableUnit(unit);
      setCableScan(unit.prt_id || unit.asset_code || '');
    } else {
      setAdapterUnit(unit);
      setAdapterScan(unit.prt_id || unit.asset_code || '');
    }
  };

  const assignScan = (code, preferredRole) => {
    const hit = stock.find((u) => {
      const codes = [u.prt_id, u.asset_code, u.serial_number].map((x) => String(x || '').toUpperCase());
      return codes.includes(String(code || '').toUpperCase());
    });
    const role = preferredRole || hit?.kit_role || kitRoleOf(hit || { part_name: code });
    if (role === 'cable') {
      setCableScan(code);
      setCableUnit(hit || { prt_id: code, kit_role: 'cable' });
    } else {
      setAdapterScan(code);
      setAdapterUnit(hit || { prt_id: code, kit_role: 'adapter' });
    }
  };

  const adapters = useMemo(() => stock.filter((u) => (u.kit_role || kitRoleOf(u)) === 'adapter'), [stock]);
  const cables = useMemo(() => stock.filter((u) => (u.kit_role || kitRoleOf(u)) === 'cable'), [stock]);
  const visibleRows = useMemo(() => {
    if (tab !== 'attached' && tab !== 'all') return rows;
    if (!dayFilter) return rows;
    return rows.filter((r) => isSameIstDay(r.attached_at || r.handed_over_at || r.requested_at, dayFilter));
  }, [rows, tab, dayFilter]);
  const todayAttached = useMemo(
    () => rows.filter((r) => r.status === 'attached' && isSameIstDay(r.attached_at, todayIst())).length,
    [rows]
  );

  const handOver = async () => {
    if (!active) return;
    if (!adapterScan.trim() || !cableScan.trim()) {
      toast.error('Scan both Laptop Charger Power Adapter and Power cable');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        adapter: adapterUnit?.instance_id
          ? { instance_id: adapterUnit.instance_id }
          : { scan_code: adapterScan },
        cable: cableUnit?.instance_id
          ? { instance_id: cableUnit.instance_id }
          : { scan_code: cableScan },
      };
      const { data } = await approveChargerHandover(active.request_id, payload);
      toast.success(data.message || 'Adapter and power cable handed over');
      setActive(null);
      resetKit();
      await load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Handover failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <PlugZap className="w-5 h-5 text-amber-600" /> Dispatch chargers
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Hand over both products: Laptop Charger Power Adapter and Power cable.
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${
              tab === t.id ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
        {(tab === 'attached' || tab === 'all') ? (
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            Date
            <input
              type="date"
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              className="border rounded-lg px-2 py-1 text-sm"
            />
            <button type="button" className="text-xs font-semibold text-amber-700 hover:underline" onClick={() => setDayFilter(todayIst())}>
              Today
            </button>
            <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setDayFilter('')}>
              All dates
            </button>
          </label>
        ) : null}
      </div>

      {(tab === 'attached' || tab === 'all') ? (
        <p className="text-sm text-slate-600">
          {todayAttached} laptop{todayAttached === 1 ? '' : 's'} have a charger kit attached today.
          {dayFilter ? ` Showing ${visibleRows.length} for ${dayFilter}.` : ''}
        </p>
      ) : null}

      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…</div>
        ) : !visibleRows.length ? (
          <div className="p-8 text-center text-slate-500">No charger requests in this view.</div>
        ) : (
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Request</th>
                <th className="px-3 py-2">TTSPL</th>
                <th className="px-3 py-2">S/N</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Adapter</th>
                <th className="px-3 py-2">Cable</th>
                <th className="px-3 py-2">SO</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attached</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.request_id} className="border-t">
                  <td className="px-3 py-2 font-mono">{r.request_number}</td>
                  <td className="px-3 py-2 font-mono">{r.ttspl_id || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.serial_number || '—'}</td>
                  <td className="px-3 py-2">{r.brand || '—'}</td>
                  <td className="px-3 py-2">{r.model || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.adapter_label || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.cable_label || '—'}</td>
                  <td className="px-3 py-2">{r.sales_order_number || r.ticket_so || '—'}</td>
                  <td className="px-3 py-2 capitalize">{r.status.replaceAll('_', ' ')}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{formatWhen(r.attached_at)}</td>
                  <td className="px-3 py-2 text-right">
                    {r.status === 'pending' ? (
                      <button
                        type="button"
                        onClick={() => { setActive(r); resetKit(); }}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold"
                      >
                        Approve &amp; hand over
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {active ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setActive(null)} aria-label="Close" />
          <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-slate-900">Hand over kit for {active.ttspl_id || 'laptop'}</h3>
            <p className="text-sm text-slate-700">{laptopSpec(active)}</p>
            <p className="text-xs text-slate-500">Scan or select both products. Handover is not complete until both are chosen.</p>

            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                  {adapterUnit ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : null}
                  1. Laptop charger / adapter
                </p>
                <ScanField
                  value={adapterScan}
                  onChange={setAdapterScan}
                  onScan={(code) => assignScan(code, 'adapter')}
                  placeholder="Scan adapter PRT"
                  aria-label="Scan adapter"
                />
                <p className="text-[11px] text-slate-500">{adapterUnit?.part_name || 'Not selected yet'}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                  {cableUnit ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : null}
                  2. Power cable
                </p>
                <ScanField
                  value={cableScan}
                  onChange={setCableScan}
                  onScan={(code) => assignScan(code, 'cable')}
                  placeholder="Scan power cable PRT"
                  aria-label="Scan power cable"
                />
                <p className="text-[11px] text-slate-500">{cableUnit?.part_name || 'Not selected yet'}</p>
              </div>
            </div>

            <button
              type="button"
              disabled={saving || !adapterScan.trim() || !cableScan.trim()}
              onClick={handOver}
              className="w-full px-3 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Hand over adapter + power cable'}
            </button>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
              <input
                value={stockQ}
                onChange={(e) => setStockQ(e.target.value)}
                placeholder="Search in-stock adapters and cables"
                className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm"
              />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <ul className="max-h-48 overflow-y-auto divide-y border rounded-lg">
                <li className="px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-500 bg-slate-50">Adapters</li>
                {adapters.map((u) => (
                  <li key={u.instance_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div>
                      <p className="font-mono font-medium">{u.prt_id || u.asset_code}</p>
                      <p className="text-xs text-slate-500">{u.part_name}</p>
                    </div>
                    <button type="button" disabled={saving} onClick={() => pickUnit(u)} className="text-xs font-semibold text-amber-700 hover:underline disabled:opacity-50">
                      Select
                    </button>
                  </li>
                ))}
                {!adapters.length ? <li className="px-3 py-3 text-xs text-slate-500">No adapters in stock.</li> : null}
              </ul>
              <ul className="max-h-48 overflow-y-auto divide-y border rounded-lg">
                <li className="px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-500 bg-slate-50">Power cables</li>
                {cables.map((u) => (
                  <li key={u.instance_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div>
                      <p className="font-mono font-medium">{u.prt_id || u.asset_code}</p>
                      <p className="text-xs text-slate-500">{u.part_name}</p>
                    </div>
                    <button type="button" disabled={saving} onClick={() => pickUnit(u)} className="text-xs font-semibold text-amber-700 hover:underline disabled:opacity-50">
                      Select
                    </button>
                  </li>
                ))}
                {!cables.length ? <li className="px-3 py-3 text-xs text-slate-500">No power cables in stock.</li> : null}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
