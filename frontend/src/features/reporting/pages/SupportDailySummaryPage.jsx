import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Truck, MessageSquare, RefreshCw, PackageCheck } from 'lucide-react';
import api from '../../../utils/api';

const today = () => new Date().toISOString().slice(0, 10);

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

export default function SupportDailySummaryPage() {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [assignee, setAssignee] = useState('');
  const [team, setTeam] = useState('');
  const [technicians, setTechnicians] = useState([]);
  const [teams, setTeams] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/reports/support-daily-summary/filters')
      .then((r) => {
        setTechnicians(r.data.technicians || []);
        setTeams(r.data.teams || []);
      })
      .catch(() => { setTechnicians([]); setTeams([]); });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/support-daily-summary', { params: { from, to, assignee, team } });
      setSummary(res.data.summary || null);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, assignee, team]);

  useEffect(() => { load(); }, [load]);

  const resetFilters = () => {
    setFrom(today());
    setTo(today());
    setAssignee('');
    setTeam('');
  };

  const returned = summary?.returned;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Daily Support Summary</h1>
        <p className="text-sm text-gray-500 mt-1">Support team KPIs for the selected date range and filters</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">Team</span>
          <select value={team} onChange={(e) => setTeam(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[150px]">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">User</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[160px]">
            <option value="">All users</option>
            {technicians.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={load}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">Apply</button>
        <button type="button" onClick={resetFilters}
          className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Reset</button>
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
