import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, ScanLine, ShieldAlert, Clock } from 'lucide-react';
import { SearchField } from '../../components/ui/primitives';
import { getGuardDashboard } from './guardGateApi';

function Stat({
  label, value, icon: Icon, tone, active, onClick,
}) {
  const tones = {
    teal: 'bg-teal-50 text-teal-800 ring-teal-400',
    orange: 'bg-orange-50 text-orange-800 ring-orange-400',
    amber: 'bg-amber-50 text-amber-800 ring-amber-400',
    red: 'bg-red-50 text-red-800 ring-red-400',
  };
  const toneClasses = tones[tone] || tones.teal;
  const className = [
    'rounded-2xl p-4 text-left w-full transition-shadow',
    toneClasses.split(' ').slice(0, 2).join(' '),
    onClick ? 'cursor-pointer hover:shadow-md active:scale-[0.98]' : '',
    active ? `ring-2 ring-offset-2 ${toneClasses.split(' ')[2]}` : '',
  ].join(' ');

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} aria-pressed={active}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium opacity-80">{label}</p>
          <Icon className="w-4 h-4 opacity-70" />
        </div>
        <p className="text-3xl font-bold tabular-nums">{value}</p>
        {active ? <p className="text-[10px] mt-1 opacity-70">Tap again to clear</p> : null}
      </button>
    );
  }

  return (
    <div className={className}>
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

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function looksLikeDocumentScan(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/RFXG1\|/i.test(s)) return true;
  if (/^(G?DC|RDC|SDC|VRDC|GRN|SO|TTSPL)/i.test(s)) return true;
  return false;
}

function guessScannerDirection(query) {
  const s = String(query || '').trim().toUpperCase();
  if (/^RDC|^VRDC.*-R|^VRDC.*-REP|^GRN/i.test(s)) return 'inward';
  if (/^DC|^SO|^SDC/i.test(s)) return 'outward';
  return 'inward';
}

function listTitle({ directionFilter, isSearching, searchDebounced }) {
  if (directionFilter === 'inward') return "Today's inward scans";
  if (directionFilter === 'outward') return "Today's outward scans";
  if (isSearching) return 'Search results';
  return 'Recent scans';
}

export default function GuardDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [directionFilter, setDirectionFilter] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (searchDebounced) params.q = searchDebounced;
    if (directionFilter) params.direction = directionFilter;
    getGuardDashboard(Object.keys(params).length ? params : undefined)
      .then((r) => setData(r.data?.data || r.data))
      .catch((err) => setError(err.response?.data?.message || 'Unable to load dashboard'))
      .finally(() => setLoading(false));
  }, [searchDebounced, directionFilter]);

  const recent = data?.recent || [];
  const isSearching = Boolean(searchDebounced);
  const scannerDir = directionFilter || guessScannerDirection(searchDebounced);
  const scannerHref = searchDebounced
    ? `/guard/scanner?dir=${scannerDir}&q=${encodeURIComponent(searchDebounced)}`
    : `/guard/scanner?dir=${directionFilter || 'inward'}`;

  const toggleDirection = (dir) => {
    setDirectionFilter((prev) => (prev === dir ? null : dir));
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Gate dashboard</h1>
        <p className="text-sm text-slate-500">Today’s inward and outward scans</p>
      </div>

      <SearchField
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search TTSPL, serial, DC, RDC, AWB, guard…"
        className="max-w-none w-full"
      />

      {isSearching && looksLikeDocumentScan(searchDebounced) ? (
        <Link
          to={scannerHref}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border-2 border-teal-600 text-teal-700 bg-teal-50 font-semibold text-sm"
        >
          <ScanLine className="w-5 h-5" />
          Open scanner for {searchDebounced}
        </Link>
      ) : null}

      {error ? (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Today's Inward"
          value={data?.inward_today ?? '—'}
          icon={ArrowDownToLine}
          tone="teal"
          active={directionFilter === 'inward'}
          onClick={() => toggleDirection('inward')}
        />
        <Stat
          label="Today's Outward"
          value={data?.outward_today ?? '—'}
          icon={ArrowUpFromLine}
          tone="orange"
          active={directionFilter === 'outward'}
          onClick={() => toggleDirection('outward')}
        />
        <Stat label="Pending Validation" value={data?.pending_validation ?? '—'} icon={Clock} tone="amber" />
        <Stat label="Invalid Attempts" value={data?.invalid_today ?? '—'} icon={ShieldAlert} tone="red" />
      </div>

      {directionFilter ? (
        <button
          type="button"
          onClick={() => setDirectionFilter(null)}
          className="text-xs text-slate-600 underline"
        >
          Clear {directionFilter} filter · show recent scans
        </button>
      ) : null}

      <Link
        to={scannerHref}
        className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl bg-teal-600 text-white font-semibold text-sm shadow-sm"
      >
        <ScanLine className="w-5 h-5" />
        Open scanner
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            {listTitle({ directionFilter, isSearching, searchDebounced })}
          </h2>
          <span className="text-xs text-slate-400">
            {loading ? 'Loading…' : `${recent.length} shown`}
          </span>
        </div>
        {recent.length ? (
          <ul className="divide-y divide-slate-50">
            {recent.map((row, i) => (
              <li key={`${row.scan_time}-${row.ttspl}-${row.reference_number}-${i}`} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-mono font-semibold text-slate-900 truncate">
                    {row.ttspl || row.serial_number || row.reference_number || '—'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {(row.direction || '').toUpperCase()} · {row.source_type || '—'}
                    {row.reference_number ? ` · ${row.reference_number}` : ''}
                  </p>
                  {row.awb_number ? (
                    <p className="text-[11px] text-slate-400 truncate">AWB {row.awb_number}</p>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-xs font-semibold ${row.validation_result === 'valid' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {(row.validation_result || '').toUpperCase()}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {directionFilter || isSearching ? formatDateTime(row.scan_time) : formatTime(row.scan_time)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-slate-500">
            {directionFilter
              ? `No ${directionFilter} scans today yet.`
              : isSearching
                ? `No scans match “${searchDebounced}”.`
                : 'No scans yet today.'}
          </p>
        )}
      </div>
    </div>
  );
}
