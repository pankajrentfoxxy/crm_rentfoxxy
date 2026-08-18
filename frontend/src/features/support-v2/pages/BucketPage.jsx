import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Phone } from 'lucide-react';
import { Button, Mono, PriorityChip, SlaChip, TypeTag, prioritySpine } from '../../../components/ui/supportPrimitives';
import { usePermission } from '../../../hooks/usePermission';
import { fetchMyBucket, fetchMyBucketSummary, listPartRequests } from '../supportV2Api';
import { SUPPORT_V2_BASE, woTypeLabel } from '../supportV2Utils';
import OfflineBanner from '../components/OfflineBanner';

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'overdue', label: 'Overdue', hot: true },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Done' },
];

function slotLabel(iso) {
  if (!iso) return 'Unslotted';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function JobCard({ group, onOpen }) {
  const first = group.jobs[0];
  const extra = Math.max(0, (first?.asset_count || 1) - 1);
  return (
    <div className={`bg-white rounded-[10px] border border-sup-lineSoft p-3 ${prioritySpine(group.priority)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <PriorityChip priority={group.priority} />
          <TypeTag type={first?.wo_type} />
        </div>
        <SlaChip dueAt={group.sla_due_at} />
      </div>
      <div className="font-semibold text-[15px] mt-1.5">{group.customer_name || 'Customer'}</div>
      <div className="text-[12px] text-sup-muted">
        {group.site_label || '—'}
        {group.distance_km != null ? ` · ${Number(group.distance_km).toFixed(1)} km` : ''}
      </div>
      <div className="text-[12px] mt-1">
        {first?.asset_count || 1} machine{(first?.asset_count || 1) === 1 ? '' : 's'}
        {first?.primary_ttspl ? <> · <Mono>{first.primary_ttspl}</Mono>{extra ? ` +${extra}` : ''}</> : null}
      </div>
      {(first?.type_name || first?.issue_name) && (
        <div className="text-[12px] text-sup-ink2 mt-0.5">
          {[first.type_name, first.issue_name].filter(Boolean).join(' › ')}
        </div>
      )}
      {group.jobs.length > 1 && (
        <div className="mt-2 rounded-md bg-sup-accentSoft text-sup-accent text-[11.5px] px-2 py-1.5">
          Grouped trip — {group.jobs.length} jobs at this address
          <div className="mt-1 space-y-0.5">
            {group.jobs.map((j) => (
              <div key={j.wo_id} className="flex justify-between gap-2">
                <span>{woTypeLabel(j.wo_type)}</span>
                <Mono className="text-[10.5px]">{j.wo_number}</Mono>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <a
          className="min-h-[44px] rounded-lg border border-sup-line text-center text-[12px] font-semibold grid place-items-center"
          href={`https://maps.google.com/?q=${encodeURIComponent(group.site_label || group.customer_name || '')}`}
          target="_blank"
          rel="noreferrer"
        >
          Navigate
        </a>
        <a
          className="min-h-[44px] rounded-lg border border-sup-line text-center text-[12px] font-semibold grid place-items-center"
          href={group.contact_phone ? `tel:${group.contact_phone}` : undefined}
        >
          <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Call</span>
        </a>
        <Button size="touch" onClick={() => onOpen(first)}>Start job ▶</Button>
      </div>
    </div>
  );
}

export default function BucketPage() {
  const nav = useNavigate();
  const { user } = usePermission();
  const [tab, setTab] = useState('today');
  const [groupBy, setGroupBy] = useState('slot');
  const [navTab, setNavTab] = useState('day');
  const [groups, setGroups] = useState([]);
  const [summary, setSummary] = useState({});
  const [parts, setParts] = useState([]);

  const load = useCallback(() => {
    fetchMyBucket({ tab })
      .then((r) => setGroups(r.data?.groups || []))
      .catch(() => { toast.error('Could not load bucket'); setGroups([]); });
    fetchMyBucketSummary()
      .then((r) => setSummary(r.data?.summary || {}))
      .catch(() => setSummary({}));
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (navTab !== 'parts') return;
    listPartRequests()
      .then((r) => setParts(r.data?.rows || []))
      .catch(() => setParts([]));
  }, [navTab]);

  const sections = useMemo(() => {
    if (groupBy === 'type') {
      const map = new Map();
      for (const g of groups) {
        const k = g.jobs[0]?.wo_type || 'OTHER';
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(g);
      }
      return [...map.entries()].map(([k, v]) => ({ title: woTypeLabel(k), items: v }));
    }
    if (groupBy === 'customer') {
      return [{ title: null, items: [...groups].sort((a, b) => String(a.customer_name).localeCompare(String(b.customer_name))) }];
    }
    if (groupBy === 'area') {
      const map = new Map();
      for (const g of groups) {
        const k = g.site_label || 'Unknown area';
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(g);
      }
      return [...map.entries()].map(([k, v]) => ({ title: k, items: v }));
    }
    const map = new Map();
    for (const g of groups) {
      const k = slotLabel(g.slot_start);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(g);
    }
    return [...map.entries()].map(([k, v]) => ({ title: k, items: v }));
  }, [groups, groupBy]);

  const next = summary.next;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="max-w-lg mx-auto min-h-[100dvh] flex flex-col bg-sup-canvas pb-16">
      <div className="bg-sup-ink text-white px-4 pt-4 pb-3">
        <div className="text-[11px] text-white/70">{today} · {user?.name || 'Technician'}</div>
        <div className="text-[13px] font-semibold mt-0.5">
          {summary.today || 0} jobs · {summary.done || 0} done · {summary.overdue || 0} overdue
        </div>
        <div className="h-1.5 bg-white/15 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-sup-accent2"
            style={{ width: `${Math.min(100, ((summary.done || 0) / Math.max(1, summary.today || 0)) * 100)}%` }}
          />
        </div>
        {next && (
          <div className="text-[12px] mt-2 text-white/90">
            Next — {slotLabel(next.slot_start)} {next.customer_name}
            {next.site_label ? `, ${next.site_label}` : ''}
            {next.distance_km != null ? ` · ${Number(next.distance_km).toFixed(1)} km` : ''}
          </div>
        )}
      </div>
      <div className="px-3 pt-3"><OfflineBanner /></div>

      {navTab === 'day' && (
        <>
          <div className="flex gap-1 px-3 pt-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`min-h-[36px] px-3 rounded-full text-[12px] font-semibold border
                  ${tab === t.id
                    ? (t.hot ? 'bg-pri1 text-white border-pri1' : 'bg-sup-accent text-white border-sup-accent')
                    : (t.hot ? 'text-pri1 border-pri1' : 'border-sup-line text-sup-ink2')}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 text-[11px]">
            <span className="text-sup-muted">Group by</span>
            {['slot', 'customer', 'type', 'area'].map((g) => (
              <button key={g} type="button" onClick={() => setGroupBy(g)}
                className={`px-2 h-7 rounded ${groupBy === g ? 'bg-sup-canvas2 font-semibold' : 'text-sup-muted'}`}>
                {g === 'slot' ? 'time slot' : g === 'type' ? 'job type' : g}
              </button>
            ))}
          </div>
          <div className="px-3 space-y-3 pb-4">
            {sections.map((s) => (
              <div key={s.title || 'all'}>
                {s.title && <div className="text-[10px] uppercase tracking-wider text-sup-faint font-semibold mb-1">{s.title}</div>}
                <div className="space-y-2">
                  {s.items.map((g) => (
                    <JobCard key={g.group_key} group={g} onOpen={(j) => nav(`${SUPPORT_V2_BASE}/jobs/${j.wo_id}`)} />
                  ))}
                </div>
              </div>
            ))}
            {!groups.length && <p className="text-[12px] text-sup-muted p-4">No jobs in this tab.</p>}
          </div>
        </>
      )}

      {navTab === 'history' && (
        <div className="p-3 text-[12px] text-sup-muted">Switch to Done to see completed jobs from the last 14 days.</div>
      )}
      {navTab === 'parts' && (
        <div className="p-3 space-y-2">
          {parts.map((p) => (
            <div key={p.request_id} className="bg-white border border-sup-lineSoft rounded-lg p-3 text-[12px]">
              <Mono bold>{p.request_number}</Mono>
              <div>{p.catalog_name || p.part_name}</div>
              <div className="text-sup-muted">{p.status_v2}</div>
            </div>
          ))}
          {!parts.length && <p className="text-[12px] text-sup-muted">No part requests.</p>}
        </div>
      )}
      {navTab === 'profile' && (
        <div className="p-4 text-[13px]">
          <div className="font-semibold">{user?.name}</div>
          <div className="text-sup-muted">{user?.role}</div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-sup-lineSoft grid grid-cols-4 text-[11px] font-semibold">
        {[
          { id: 'day', label: 'My day' },
          { id: 'history', label: 'History', go: () => { setNavTab('day'); setTab('completed'); } },
          { id: 'parts', label: 'My parts' },
          { id: 'profile', label: 'Profile' },
        ].map((b) => (
          <button
            key={b.id}
            type="button"
            className={`min-h-[52px] ${navTab === b.id || (b.id === 'history' && tab === 'completed') ? 'text-sup-accent' : 'text-sup-muted'}`}
            onClick={() => { if (b.go) b.go(); else setNavTab(b.id); }}
          >
            {b.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
