import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Truck, MessageSquare, RefreshCw, PackageCheck } from 'lucide-react';
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
  if (preset === 'yesterday') return { from: yesterday(), to: yesterday() };
  if (preset === 'custom' || preset === 'all') return { from: '', to: '' };
  return { from: today(), to: today() };
};

const paramsForFilters = (f) => {
  const base = { assignee: f.assignee, team: f.team };
  if (f.preset === 'all') return { ...base, all_time: 1 };
  if (f.from && f.to) return { ...base, from: f.from, to: f.to };
  return { ...base, all_time: 1 };
};

const GROUPS = [
  {
    key: 'pickup',
    title: 'Daily Pickup',
    icon: Truck,
    accent: 'amber',
    cards: [
      { key: 'pending', label: 'Pending Pickup' },
      { key: 'followup', label: 'Follow-up Pickup' },
    ],
  },
  {
    key: 'complaints',
    title: 'Daily Complaints',
    icon: MessageSquare,
    accent: 'blue',
    cards: [
      { key: 'pending', label: 'Pending Complaints' },
      { key: 'resolved', label: 'Resolved Complaints' },
    ],
  },
  {
    key: 'replacements',
    title: 'Daily Replacements',
    icon: RefreshCw,
    accent: 'purple',
    cards: [
      { key: 'pickup_completed', label: 'Pickup Completed' },
      { key: 'completed', label: 'Replacement Completed' },
    ],
  },
];

const ACCENT = {
  amber: { bar: 'bg-amber-500', icon: 'bg-amber-100 text-amber-600', value: 'text-amber-600' },
  blue: { bar: 'bg-blue-500', icon: 'bg-blue-100 text-blue-600', value: 'text-blue-600' },
  purple: { bar: 'bg-purple-500', icon: 'bg-purple-100 text-purple-600', value: 'text-purple-600' },
  green: { bar: 'bg-green-500', icon: 'bg-green-100 text-green-600', value: 'text-green-600' },
};

function StatTile({ label, value, accent }) {
  const a = ACCENT[accent] || ACCENT.blue;
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-4 py-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${a.value}`}>{value ?? 0}</p>
    </div>
  );
}

function GroupCard({ group, data }) {
  const a = ACCENT[group.accent] || ACCENT.blue;
  const Icon = group.icon;
  return (
    <div className="relative overflow-hidden bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <span className={`absolute left-0 top-0 h-full w-1 ${a.bar}`} />
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${a.icon}`}>
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">{group.title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {group.cards.map((c) => (
          <StatTile key={c.key} label={c.label} value={data?.[c.key]} accent={group.accent} />
        ))}
      </div>
    </div>
  );
}

const DEFAULT_FILTERS = { preset: 'today', from: today(), to: today(), assignee: '', team: '' };

export default function SupportDailySummaryPage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [technicians, setTechnicians] = useState([]);
  const [teams, setTeams] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const setPreset = (preset) => setFilters((f) => ({ ...f, preset, ...(preset === 'custom' ? {} : rangeForPreset(preset)) }));
  const setDate = (key, value) => setFilters((f) => ({ ...f, preset: 'custom', [key]: value }));

  useEffect(() => {
    api.get('/reports/support-daily-summary/filters')
      .then((r) => {
        setTechnicians(r.data.technicians || []);
        setTeams(r.data.teams || []);
      })
      .catch(() => { setTechnicians([]); setTeams([]); });
  }, []);

  const load = useCallback(async (f) => {
    setLoading(true);
    try {
      const res = await api.get('/reports/support-daily-summary', { params: paramsForFilters(f) });
      setSummary(res.data.summary || null);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [filters, load]);

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  const returned = summary?.returned;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Daily Support Summary</h1>
        <p className="text-sm text-gray-500 mt-1">Support team KPIs for the selected date range and filters</p>
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
            <span className="block text-gray-500 text-xs mb-1">Team</span>
            <select value={filters.team} onChange={(e) => set('team', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[150px]">
              <option value="">All teams</option>
              {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">User</span>
            <select value={filters.assignee} onChange={(e) => set('assignee', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[160px]">
              <option value="">All users</option>
              {technicians.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={resetFilters}
            className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Clear</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {GROUPS.map((g) => <GroupCard key={g.key} group={g} data={summary?.[g.key]} />)}
          </div>

          <div className="relative overflow-hidden bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <span className={`absolute left-0 top-0 h-full w-1 ${ACCENT.green.bar}`} />
            <div className="flex items-center gap-2 mb-4">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${ACCENT.green.icon}`}>
                <PackageCheck className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">Daily Returned Laptops</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-green-100 bg-green-50/70 px-4 py-3">
                <p className="text-xs font-medium text-gray-500">Total Returned</p>
                <p className="mt-1 text-3xl font-bold text-green-600">{returned?.total ?? 0}</p>
              </div>
              <StatTile label="Pickup" value={returned?.pickup} accent="amber" />
              <StatTile label="Replacement" value={returned?.replacement} accent="purple" />
              <StatTile label="Complaint" value={returned?.complaint} accent="blue" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
