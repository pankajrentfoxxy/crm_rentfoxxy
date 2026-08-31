import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, ScanLine, ShieldAlert, Clock } from 'lucide-react';
import { getGuardDashboard } from './guardGateApi';

function Stat({ label, value, icon: Icon, tone }) {
  const tones = {
    teal: 'bg-teal-50 text-teal-800',
    orange: 'bg-orange-50 text-orange-800',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-800',
  };
  return (
    <div className={`rounded-2xl p-4 ${tones[tone] || tones.teal}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium opacity-80">{label}</p>
        <Icon className="w-4 h-4 opacity-70" />
      </div>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export default function GuardDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getGuardDashboard()
      .then((r) => setData(r.data?.data || r.data))
      .catch((err) => setError(err.response?.data?.message || 'Unable to load dashboard'));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Gate dashboard</h1>
        <p className="text-sm text-slate-500">Today’s inward and outward scans</p>
      </div>

      {error ? (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Today's Inward" value={data?.inward_today ?? '—'} icon={ArrowDownToLine} tone="teal" />
        <Stat label="Today's Outward" value={data?.outward_today ?? '—'} icon={ArrowUpFromLine} tone="orange" />
        <Stat label="Pending Validation" value={data?.pending_validation ?? '—'} icon={Clock} tone="amber" />
        <Stat label="Invalid Attempts" value={data?.invalid_today ?? '—'} icon={ShieldAlert} tone="red" />
      </div>

      <Link
        to="/guard/scanner"
        className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl bg-teal-600 text-white font-semibold text-sm shadow-sm"
      >
        <ScanLine className="w-5 h-5" />
        Open scanner
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Recent scans</h2>
        </div>
        {(data?.recent || []).length ? (
          <ul className="divide-y divide-slate-50">
            {data.recent.map((row, i) => (
              <li key={`${row.scan_time}-${row.ttspl}-${i}`} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-mono font-semibold text-slate-900 truncate">
                    {row.ttspl || row.serial_number || '—'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {(row.direction || '').toUpperCase()} · {row.source_type || '—'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-xs font-semibold ${row.validation_result === 'valid' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {(row.validation_result || '').toUpperCase()}
                  </p>
                  <p className="text-[11px] text-slate-400">{formatTime(row.scan_time)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-slate-500">No scans yet today.</p>
        )}
      </div>
    </div>
  );
}
