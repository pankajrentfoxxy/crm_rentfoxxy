import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, EmptyState, Mono, PageHeader, PriorityChip, SlaChip, StatusPill,
  ClassificationChain, prioritySpine, StatCard,
} from '../../../components/ui/supportPrimitives';
import PermissionGate from '../../../components/PermissionGate';
import { fetchDashboard } from '../supportV2Api';

const PRI = {
  1: { label: 'P1', bar: 'bg-pri1', text: 'text-pri1' },
  2: { label: 'P2', bar: 'bg-pri2', text: 'text-pri2' },
  3: { label: 'P3', bar: 'bg-pri3', text: 'text-pri3' },
  4: { label: 'P4', bar: 'bg-pri4', text: 'text-pri4' },
};

function capTone(row) {
  if (row.on_leave) return 'bg-sup-canvas2';
  if (row.over) return 'bg-pri1';
  if (row.max_jobs && row.jobs_today / row.max_jobs >= 0.8) return 'bg-pri2';
  return 'bg-sup-ok';
}

export default function CommandCentrePage() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboard()
      .then((r) => setData(r.data))
      .catch((e) => toast.error(e.response?.data?.message || 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-6 text-[12.5px] text-sup-muted">Loading command centre…</div>;
  }
  if (!data) {
    return <EmptyState title="Command centre unavailable" hint="Check support_dashboard · view" />;
  }

  const k = data.kpis || {};
  const mix = data.priority_mix || {};
  const mixTotal = [1, 2, 3, 4].reduce((n, p) => n + Number(mix[p] || 0), 0) || 1;
  const waiting = data.waiting || {};
  const quality = data.quality || {};

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      <PageHeader
        title="Command centre"
        subtitle="What needs a decision in the next four hours."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          alarm
          label="Breaching in 4 h"
          value={k.breaching_4h ?? 0}
          hint={`${k.breaching_4h_p1 || 0} of them P1`}
        />
        <StatCard
          label="Unassigned"
          value={k.unassigned ?? 0}
          hint={`${k.unassigned_field || 0} field jobs`}
        />
        <StatCard
          label="Open tickets"
          value={k.open ?? 0}
          hint={k.open_delta ? `+${k.open_delta} in last 24 h` : 'No new tickets today'}
        />
        <StatCard
          label="Resolution SLA · MTD"
          value={`${k.sla_mtd_pct ?? 0}%`}
          hint={`Target ${k.sla_target_pct}% · ${k.breaches_mtd || 0} breaches`}
        />
      </div>

      {(data.pinned || []).length > 0 && (
        <div className="bg-[#FEF7F8] border border-pri1-ring rounded-[10px] shadow-sup px-4 py-3">
          <div className="text-[13px] font-semibold text-pri1 mb-2">Pinned — 150% past SLA</div>
          {data.pinned.map((r) => (
            <button
              key={r.ticket_id}
              type="button"
              onClick={() => nav(`/support/tickets/${r.ticket_id}`)}
              className="w-full text-left py-1.5 flex items-center gap-2"
            >
              <PriorityChip priority={r.priority} />
              <Mono bold className="text-[11px]">{r.ticket_number}</Mono>
              <span className="text-[12.5px] truncate">{r.customer_name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3">
        <div className="bg-white border border-sup-line rounded-[10px] shadow-sup">
          <div className="flex items-center justify-between px-4 py-3 border-b border-sup-lineSoft">
            <div className="text-[13px] font-semibold text-sup-ink">SLA risk — act now</div>
            <Button variant="ghost" size="sm" onClick={() => nav('/support/queue?view=breaching')}>
              Open queue →
            </Button>
          </div>
          <div className="divide-y divide-sup-lineSoft">
            {(data.sla_risk || []).length === 0 && (
              <div className="px-4 py-6 text-[12px] text-sup-muted">Nothing breaching or at risk.</div>
            )}
            {(data.sla_risk || []).map((r) => (
              <button
                key={r.ticket_id}
                type="button"
                onClick={() => nav(`/support/tickets/${r.ticket_id}`)}
                className={`w-full text-left px-4 py-2.5 hover:bg-sup-canvas ${prioritySpine(r.priority)}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <PriorityChip priority={r.priority} />
                  <Mono bold className="text-[11px]">{r.ticket_number}</Mono>
                  <span className="font-semibold text-[12.5px] text-sup-ink truncate">{r.customer_name}</span>
                  <div className="ml-auto">
                    <SlaChip dueAt={r.sla_resolution_due_at} startedAt={r.sla_started_at} paused={r.sla_paused} />
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <ClassificationChain {...(r.primary_classification || {})} />
                  <StatusPill status={r.status} pendingReason={r.pending_reason} />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-white border border-sup-line rounded-[10px] shadow-sup px-4 py-3">
            <div className="text-[13px] font-semibold text-sup-ink mb-3">Open tickets by priority</div>
            <div className="h-2 rounded-full overflow-hidden flex bg-sup-canvas2">
              {[1, 2, 3, 4].map((p) => (
                <i
                  key={p}
                  className={`block h-full ${PRI[p].bar}`}
                  style={{ width: `${(Number(mix[p] || 0) / mixTotal) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex gap-3 mt-2 flex-wrap">
              {[1, 2, 3, 4].map((p) => (
                <span key={p} className={`text-[11px] font-semibold ${PRI[p].text}`}>
                  {PRI[p].label} {mix[p] || 0}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-white border border-sup-line rounded-[10px] shadow-sup px-4 py-3">
            <div className="text-[13px] font-semibold text-sup-ink mb-2">Today&apos;s field capacity</div>
            {(data.capacity || []).length === 0 && (
              <div className="text-[12px] text-sup-muted">No field technicians in a group yet.</div>
            )}
            <div className="space-y-2.5">
              {(data.capacity || []).map((row) => {
                const pct = row.max_jobs ? Math.min(100, (row.jobs_today / row.max_jobs) * 100) : 0;
                return (
                  <div key={row.user_id} className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-sup-accentSoft text-sup-accent text-[11px] font-semibold grid place-items-center shrink-0">
                      {(row.name || '?').slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-sup-ink truncate">{row.name}</div>
                      <div className="text-[10px] text-sup-muted truncate">
                        {row.zone || '—'}{(row.skills || []).length ? ` · ${(row.skills || []).join(', ')}` : ''}
                      </div>
                      {row.on_leave ? (
                        <div className="text-[11px] text-sup-faint">Not available</div>
                      ) : (
                        <div className="h-1.5 rounded-full bg-sup-canvas2 mt-1 overflow-hidden">
                          <i className={`block h-full ${capTone(row)}`} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {!row.on_leave && (
                        <div className={`text-[11px] font-mono tabular-nums ${row.over ? 'text-pri1 font-semibold' : 'text-sup-muted'}`}>
                          {row.jobs_today} of {row.max_jobs} jobs{row.over ? ' · over' : ''}
                        </div>
                      )}
                      <PermissionGate section="support_dispatch" action="edit">
                        <button
                          type="button"
                          onClick={() => nav('/support/queue?view=unassigned')}
                          className="text-[11px] text-sup-accent hover:underline"
                        >
                          {row.over ? 'Rebalance' : 'Assign'}
                        </button>
                      </PermissionGate>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border border-sup-line rounded-[10px] shadow-sup px-4 py-3">
          <div className="text-[13px] font-semibold text-sup-ink mb-2">Waiting on someone</div>
          {[
            ['PENDING_CUSTOMER', 'Pending customer', true],
            ['PENDING_PART', 'Pending part', false],
            ['PENDING_VENDOR', 'Pending vendor', true],
            ['PENDING_APPROVAL', 'Pending approval', true],
          ].map(([key, label, paused]) => (
            <button
              key={key}
              type="button"
              onClick={() => nav(`/support/queue?status=PENDING&pending_reason=${key}`)}
              className="w-full flex items-center justify-between py-1.5 text-left"
            >
              <span className={`text-[12.5px] ${key === 'PENDING_PART' ? 'text-pri2 font-semibold' : 'text-sup-ink'}`}>
                {label}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-[13px] font-semibold">{waiting[key] || 0}</span>
                <span className={`text-[10px] ${key === 'PENDING_PART' ? 'text-pri2' : 'text-sup-faint'}`}>
                  {paused ? 'SLA paused' : 'SLA running'}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="bg-white border border-sup-line rounded-[10px] shadow-sup px-4 py-3">
          <div className="text-[13px] font-semibold text-sup-ink mb-2">Quality signals</div>
          <Row label="Reopened this week" value={quality.reopened_week ?? 0}
               hint={quality.reopened_delta ? `${quality.reopened_delta > 0 ? '+' : ''}${quality.reopened_delta} vs prior` : null} />
          <Row label="FCR · 30 d" value={`${quality.fcr_pct ?? 0}%`} />
          <Row label="CSAT · 30 d" value={quality.csat_30d == null ? '—' : quality.csat_30d} />
          <Row label="Repeat assets" value={quality.repeat_assets ?? 0} />
        </div>

        <PermissionGate section="support_approvals" action="view">
          <div className="bg-white border border-sup-line rounded-[10px] shadow-sup px-4 py-3">
            <div className="text-[13px] font-semibold text-sup-ink mb-2">Needs your decision</div>
            {(data.approvals || []).length === 0 && (
              <div className="text-[12px] text-sup-muted">No pending approvals.</div>
            )}
            {(data.approvals || []).map((a) => (
              <button
                key={a.approval_id}
                type="button"
                onClick={() => nav('/support/approvals')}
                className="w-full text-left py-1.5 text-[12.5px] text-sup-ink hover:text-sup-accent"
              >
                {a.label}
              </button>
            ))}
          </div>
        </PermissionGate>
      </div>
    </div>
  );
}

function Row({ label, value, hint }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-[12.5px] text-sup-ink2">{label}</span>
      <span className="text-right">
        <span className="font-mono tabular-nums text-[13px] font-semibold text-sup-ink">{value}</span>
        {hint ? <div className="text-[10px] text-sup-muted">{hint}</div> : null}
      </span>
    </div>
  );
}
