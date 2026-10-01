import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DocNumber, EmptyState, Input, Panel, Segmented, StatusChip,
} from '../../../components/carret';
import { useAuth } from '../../../context/AuthContext';
import { usePermission } from '../../../hooks/usePermission';
import AssignDrawer from './work/AssignDrawer';
import {
  claimTicket, configText, errMsg, fetchBoard, isFloorLead, shortStageLabel, stageLabel,
} from './produceShared';

/**
 * Production → Floor board.
 *
 * Open tickets only, stage by stage (the old list showed every ticket ever).
 * "My work" is what is assigned to me; "Waiting" is what nobody has picked up
 * yet in the stages my team works — anyone on that team can claim it (PD9),
 * and new laptops wait in one shared Floor Manager queue (PD1). "Stuck" is a
 * ticket that has sat at its stage for days.
 *
 * 1 Oct 2026: every row shows the serial under the TTSPL (it was hidden
 * whenever the config was known); stages are a wrapping row of short pills
 * instead of a scrolling tab strip; flags are capped at two plus "+N"; and a
 * floor lead (or anyone given "Assign floor tickets") can assign / reassign
 * straight from the row, with the same drawer the ticket page uses.
 */
const VIEWS = [
  { value: 'queue', label: 'Everything I can see' },
  { value: 'mine', label: 'My work' },
  { value: 'unassigned', label: 'Waiting' },
  { value: 'stuck', label: 'Stuck' },
];
const MAX_FLAGS = 2;

/** S/N on its own line (monospace — it is printed on the laptop), then model · config. */
function laptopLines(r) {
  const serial = r.serial_number && r.serial_number !== 'NOT_ON' ? r.serial_number : null;
  const cfg = configText(r);
  if (!serial && !cfg) return null;
  return (
    <>
      {serial && <span className="block">S/N: {serial}</span>}
      {cfg && <span className="block font-ui" style={{ whiteSpace: 'normal' }}>{cfg}</span>}
    </>
  );
}

/** Every flag on a row, most urgent first, each with one fixed tone. */
function flagsFor(r) {
  const out = [];
  if (r.highlighted) out.push({ key: 'hl', status: 'overdue', label: r.highlighted_reason || 'Needs attention', trim: true });
  if (r.qc_fail_count > 0) out.push({ key: 'qc', status: 'rejected', label: `QC failed ×${r.qc_fail_count}` });
  if (r.open_parts > 0) out.push({ key: 'pt', status: 'pending', label: `${r.open_parts} part${r.open_parts > 1 ? 's' : ''} waiting` });
  if (r.received_condition === 'not_on') out.push({ key: 'on', status: 'pending', label: "Won't power on" });
  if (r.ticket_type === 'sales_order_qc') out.push({ key: 'so', status: 'sent', label: 'Sales-order check' });
  return out;
}

export default function FloorBoardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  // Same rule as the ticket page: floor leads, or "Assign floor tickets" (migration 409).
  const canAssign = isFloorLead(user) || hasPermission('floor_ticket_assign', 'edit');
  // ?stage= lets a menu entry open one stage (Movement → Dispatch QC).
  const [params] = useSearchParams();
  const stageParam = params.get('stage') || '';
  const [stage, setStage] = useState(stageParam);
  useEffect(() => { setStage(stageParam); }, [stageParam]);
  // A technician opens on their own work; a floor manager on the whole floor.
  const [view, setView] = useState(isFloorLead(user) ? 'queue' : 'mine');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [assigning, setAssigning] = useState(null); // the row being assigned
  const [openFlags, setOpenFlags] = useState({}); // ticket_id -> show every flag

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
  const stuckDays = data?.stuck_days || 3;
  // Only stages with laptops in them (plus the one picked) — empty pills are noise.
  const stages = (data?.stages || []).filter((s) => s.count > 0 || s.name === stage);

  const cols = [
    {
      key: 't',
      header: 'Laptop',
      render: (r) => <DocNumber value={r.ttspl_id || (r.serial_number !== 'NOT_ON' ? r.serial_number : null)} />,
      sub: (r) => (r.ttspl_id ? laptopLines(r) : (configText(r) ? <span className="font-ui">{configText(r)}</span> : null)),
    },
    {
      key: 's',
      header: 'Stage',
      render: (r) => {
        const d = r.days_in_stage;
        const tone = d > 7 ? 'var(--alert-crit)' : d > stuckDays ? 'var(--alert-warn)' : undefined;
        return (
          <div style={{ minWidth: '9rem' }}>
            <span className="whitespace-nowrap text-ink" title={stageLabel(r.stage_name)}>{shortStageLabel(r.stage_name)}</span>
            <span className="block font-ui" style={{ fontSize: '12.5px', marginTop: '2px', color: tone || 'var(--ink-3)', fontWeight: tone ? 600 : 400 }}>
              {d === 0 ? 'since today' : `${d} day${d === 1 ? '' : 's'} here`}
            </span>
            {r.stage_name === 'Hold' && (
              <span className="block font-ui text-ink-3" style={{ fontSize: '12.5px', maxWidth: '16rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.hold_reason || ''}>
                from {shortStageLabel(r.hold_from_stage_name) || '?'}{r.hold_reason ? `: ${r.hold_reason}` : ''}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'w',
      header: 'Assigned to',
      render: (r) => (r.assigned_name
        ? <span className="whitespace-nowrap">{r.assigned_name}</span>
        : <span className="text-ink-3">{r.stage_name === 'Floor Manager' ? 'Waiting for triage' : 'Nobody yet'}</span>),
    },
    {
      key: 'f',
      header: 'Flags',
      render: (r) => {
        const all = flagsFor(r);
        if (!all.length) return <span className="text-ink-3">—</span>;
        const expanded = !!openFlags[r.ticket_id];
        const shown = expanded ? all : all.slice(0, MAX_FLAGS);
        const rest = all.slice(MAX_FLAGS);
        return (
          <span className="flex flex-wrap items-center" style={{ gap: '6px' }}>
            {shown.map((f) => <StatusChip key={f.key} status={f.status} label={f.label} title={f.label} className={f.trim ? 'is-trim' : ''} />)}
            {rest.length > 0 && (
              <button
                type="button"
                className="c-chip-more"
                title={expanded ? 'Show fewer' : rest.map((f) => f.label).join('\n')}
                onClick={(e) => { e.stopPropagation(); setOpenFlags((m) => ({ ...m, [r.ticket_id]: !expanded })); }}
              >
                {expanded ? 'less' : `+${rest.length}`}
              </button>
            )}
          </span>
        );
      },
    },
    {
      key: 'a',
      header: '',
      align: 'right',
      render: (r) => {
        const showAssign = canAssign && r.stage_name !== 'Hold';
        const showClaim = !r.assigned_user_id && r.can_claim;
        if (!showAssign && !showClaim) return null;
        return (
          <div className="c-row-actions" style={{ flexWrap: 'nowrap' }}>
            {showClaim && (
              <Button variant={showAssign ? 'secondary' : 'primary'} disabled={busy === r.ticket_id} onClick={(e) => { e.stopPropagation(); claim(r); }}>Claim</Button>
            )}
            {showAssign && (
              <Button
                variant={r.assigned_user_id ? 'quiet' : 'primary'}
                onClick={(e) => { e.stopPropagation(); setAssigning({ ...r, assigned_user_name: r.assigned_name }); }}
              >
                {r.stage_name === 'Floor Manager' && !r.assigned_user_id ? 'Triage' : r.assigned_user_id ? 'Reassign' : 'Assign'}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const viewCount = (v) => (v === 'mine' ? counts.mine : v === 'unassigned' ? counts.unassigned : v === 'stuck' ? counts.stuck : null);

  return (
    <DeskShell title="Floor" breadcrumb="Production" subtitle="Every laptop being refurbished, stage by stage.">
      <div className="c-stack">
        <div className="c-pills" role="group" aria-label="Stage">
          <button type="button" className={stage === '' ? 'is-on' : ''} aria-pressed={stage === ''} onClick={() => setStage('')}>
            All stages <span className="c-pill-n">{counts.total ?? 0}</span>
          </button>
          {stages.map((s) => (
            <button key={s.name} type="button" className={stage === s.name ? 'is-on' : ''} aria-pressed={stage === s.name} title={stageLabel(s.name)} onClick={() => setStage(s.name)}>
              {shortStageLabel(s.name)} <span className="c-pill-n">{s.count}</span>
            </button>
          ))}
        </div>
        <Panel
          toolbar={(
            <div className="c-toolbar">
              <Segmented
                options={VIEWS.map((v) => ({ ...v, label: viewCount(v.value) != null ? `${v.label} (${viewCount(v.value) ?? 0})` : v.label }))}
                value={view}
                onChange={setView}
                label="Which tickets"
              />
              <div className="c-toolbar-end">
                {data && <span>{data.rows.length}{data.rows.length >= 500 ? '+' : ''} laptop{data.rows.length === 1 ? '' : 's'}</span>}
                <Input type="search" placeholder="TTSPL, serial or model" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '16rem' }} aria-label="Search" />
              </div>
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

      <AssignDrawer
        ticket={assigning}
        open={!!assigning}
        onClose={() => setAssigning(null)}
        onDone={() => { setAssigning(null); load(); }}
      />
    </DeskShell>
  );
}
