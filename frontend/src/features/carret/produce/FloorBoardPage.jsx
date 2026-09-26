import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DocNumber, EmptyState, Input, Panel, Segmented, StatusChip, Tabs,
} from '../../../components/carret';
import {
  claimTicket, configText, errMsg, fetchBoard, stageLabel,
} from './produceShared';

/**
 * Production → Floor board.
 *
 * Open tickets only, stage by stage (the old list showed every ticket ever).
 * "My work" is what is assigned to me; "Waiting" is what nobody has picked up
 * yet in the stages my team works — anyone on that team can claim it (PD9),
 * and new laptops wait in one shared Floor Manager queue (PD1). "Stuck" is a
 * ticket that has sat at its stage for days.
 */
const VIEWS = [
  { value: 'queue', label: 'Everything I can see' },
  { value: 'mine', label: 'My work' },
  { value: 'unassigned', label: 'Waiting' },
  { value: 'stuck', label: 'Stuck' },
];

export default function FloorBoardPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState('');
  const [view, setView] = useState('queue');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const load = useCallback(() => {
    fetchBoard({ stage: stage || undefined, view, search: q || undefined })
      .then(({ data: d }) => setData(d))
      .catch((e) => { toast.error(errMsg(e, 'Could not load the floor')); setData({ rows: [], stages: [], counts: {} }); });
  }, [stage, view, q]);
  useEffect(() => { load(); }, [load]);

  const claim = async (r) => {
    setBusy(r.ticket_id);
    try { await claimTicket(r.ticket_id); toast.success(`${r.ttspl_id} is yours`); navigate(`/carret/produce/tickets/${r.ticket_id}`); } catch (e) { toast.error(errMsg(e)); load(); } finally { setBusy(null); }
  };

  const counts = data?.counts || {};
  const stages = (data?.stages || []).filter((s) => s.count > 0 || ['Floor Manager', 'Diagnosis', 'QC1', 'QC2', 'Pending Inventory', 'Hold'].includes(s.name));
  const cols = [
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => configText(r) || r.serial_number },
    {
      key: 's',
      header: 'Stage',
      render: (r) => stageLabel(r.stage_name),
      sub: (r) => (r.stage_name === 'Hold' ? `held from ${r.hold_from_stage_name || '?'}: ${r.hold_reason || ''}` : (r.ticket_type === 'sales_order_qc' ? 'Sales-order check' : null)),
    },
    {
      key: 'd',
      header: 'At this stage',
      numeric: true,
      render: (r) => <span style={{ color: r.days_in_stage > 7 ? 'var(--alert-crit)' : r.days_in_stage > (data?.stuck_days || 3) ? 'var(--alert-warn)' : undefined }}>{r.days_in_stage === 0 ? 'today' : `${r.days_in_stage} d`}</span>,
    },
    {
      key: 'w',
      header: 'Who',
      render: (r) => (r.assigned_name || (r.can_claim
        ? <Button variant="primary" disabled={busy === r.ticket_id} onClick={(e) => { e.stopPropagation(); claim(r); }}>Claim</Button>
        : <span className="text-ink-3">waiting</span>)),
    },
    {
      key: 'f',
      header: 'Flags',
      render: (r) => (
        <span className="flex flex-wrap" style={{ gap: '6px' }}>
          {r.highlighted && <StatusChip status="overdue" label={r.highlighted_reason ? r.highlighted_reason.slice(0, 40) : 'Attention'} />}
          {r.open_parts > 0 && <StatusChip status="pending" label={`${r.open_parts} part${r.open_parts > 1 ? 's' : ''}`} />}
          {r.qc_fail_count > 0 && <StatusChip status="rejected" label={`QC failed ×${r.qc_fail_count}`} />}
          {r.received_condition === 'not_on' && <StatusChip status="pending" label="Won't power on" />}
        </span>
      ),
    },
  ];

  return (
    <DeskShell title="Floor" breadcrumb="Production" subtitle="Every laptop being refurbished, stage by stage.">
      <div className="c-stack">
        <Tabs
          value={stage}
          onChange={setStage}
          tabs={[{ key: '', label: 'All stages', count: counts.total }, ...stages.map((s) => ({ key: s.name, label: stageLabel(s.name), count: s.count }))]}
        />
        <Panel
          toolbar={(
            <div className="flex items-center flex-wrap" style={{ gap: '12px', width: '100%' }}>
              <Segmented
                options={VIEWS.map((v) => ({ ...v, label: `${v.label}${v.value === 'mine' ? ` (${counts.mine ?? 0})` : v.value === 'unassigned' ? ` (${counts.unassigned ?? 0})` : v.value === 'stuck' ? ` (${counts.stuck ?? 0})` : ''}` }))}
                value={view}
                onChange={setView}
                label="Which tickets"
              />
              <Input type="search" placeholder="TTSPL, serial or model" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: '16rem' }} aria-label="Search" />
            </div>
          )}
        >
          {!data ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={cols}
              rows={data.rows}
              rowKey={(r) => r.ticket_id}
              onRowClick={(r) => navigate(`/carret/produce/tickets/${r.ticket_id}`)}
              empty={<EmptyState title={view === 'mine' ? 'Nothing assigned to you' : 'Nothing here'} body={view === 'mine' ? 'Pick something up from "Waiting".' : undefined} />}
            />
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
