import React, { useMemo, useState, useCallback } from 'react';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, FilterBar, Panel, StatusChip, DocNumber, DateTime, EmptyState, Button, StatTile, Segmented,
} from '../../components/carret';
import { useFloorPipeline, useFloorTickets } from './useProduce';

/**
 * Floor Pipeline, and the six stage views (Part 5.7).
 *
 * ONE screen. The stage is a filter along the top, not six entries in the menu
 * — the same reasoning as Decision 1's entity split: a laptop moving from QC1
 * to QC2 should not move between sections, and a floor manager asking "what is
 * on the floor" should not have to open six screens and add them up.
 *
 * The stage strip doubles as the pipeline view. Counts come from
 * /tickets/floor-dashboard, which reads stages in stage_order — an order that
 * only became a real sequence in migration 270, because Dispatch QC used to
 * share stage_order 10 with QC2.
 *
 * Three columns exist because Part 5 made the facts behind them true:
 *
 *   Attempt     qc_fail_count was incremented and read by nobody, so a laptop
 *               on its fourth trip round QC1 <-> Assembly looked exactly like
 *               one arriving for the first time. Now the count is on screen,
 *               and the third attempt escalates instead of looping.
 *   Held        the security hold moved nothing and returned success. It moves
 *               now, and the reason is recorded, so a held unit is visible.
 *   Flag        the highlight, which already existed and had nowhere to show.
 */

const STAGE_GROUPS = [
  { key: '', label: 'All' },
  { key: 'Floor Manager', label: 'Floor Manager' },
  { key: 'Diagnosis', label: 'Diagnosis' },
  { key: 'Assembly & Software', label: 'Assembly' },
  { key: 'Final Testing', label: 'Final Testing' },
  { key: 'QC1', label: 'QC1' },
  { key: 'QC2', label: 'QC2' },
  { key: 'Dispatch QC', label: 'Dispatch QC' },
  { key: 'Pending Inventory', label: 'Pending Inventory' },
];

/** A ticket that has failed twice is one failure from escalation. Say so. */
function AttemptCell({ row }) {
  const n = Number(row.qc_fail_count || 0);
  if (!n) return <span className="text-ink-3">first</span>;
  const escalated = !!row.qc_escalated_at;
  return (
    <span
      className="font-mono tabular-nums"
      style={{ color: escalated ? 'var(--alert-crit)' : n >= 2 ? 'var(--alert-warn)' : 'var(--ink-2)' }}
    >
      {escalated ? `escalated after ${n}` : `attempt ${n + 1}`}
    </span>
  );
}

export default function FloorPipelinePage() {
  const [stage, setStage] = useState('');
  const [filters, setFilters] = useState({});

  const pipeline = useFloorPipeline();
  const { loading, error, rows, total } = useFloorTickets({
    stage,
    search: filters.search || '',
    priority: filters.priority || '',
  });

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => { setFilters({}); setStage(''); }, []);

  const countFor = useCallback((name) => {
    if (!name) return pipeline.stages.reduce((a, s) => a + Number(s.count || 0), 0);
    const hit = pipeline.stages.find((s) => s.stage_name === name);
    return hit ? Number(hit.count || 0) : 0;
  }, [pipeline.stages]);

  const columns = useMemo(() => [
    {
      key: 'ttspl_display',
      header: 'Asset',
      render: (r) => (r.ttspl_display
        ? <DocNumber value={r.ttspl_display} />
        : <span className="text-ink-3">no TTSPL</span>),
    },
    {
      key: 'machine',
      header: 'Laptop',
      render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—',
    },
    { key: 'stage_name', header: 'Stage', render: (r) => <StatusChip status={r.stage_name} /> },
    { key: 'assigned_user_name', header: 'With', render: (r) => r.assigned_user_name || <span className="text-ink-3">unassigned</span> },
    { key: 'attempt', header: 'Attempt', render: (r) => <AttemptCell row={r} /> },
    {
      key: 'held',
      header: 'Held',
      render: (r) => (r.security_hold_at
        ? <span style={{ color: 'var(--alert-crit)' }} title={r.security_hold_reason || ''}>security hold</span>
        : <span className="text-ink-3">—</span>),
    },
    {
      key: 'flag',
      header: 'Flag',
      render: (r) => (r.highlighted
        ? <span style={{ color: 'var(--alert-warn)' }} title={r.highlighted_reason || ''}>{r.highlighted_reason || 'flagged'}</span>
        : <span className="text-ink-3">—</span>),
    },
    { key: 'updated_at', header: 'Moved', render: (r) => <DateTime value={r.updated_at || r.created_at} /> },
  ], []);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'TTSPL, serial or model' },
    {
      key: 'priority',
      label: 'Priority',
      options: [
        { value: 'high', label: 'high' },
        { value: 'normal', label: 'normal' },
        { value: 'sales_order', label: 'sales order' },
      ],
    },
  ]), []);

  const escalated = rows.filter((r) => r.qc_escalated_at).length;
  const held = rows.filter((r) => r.security_hold_at).length;

  return (
    <DeskShell
      title="Floor Pipeline"
      breadcrumb="Produce"
      subtitle="Every laptop on the refurbishment floor, by stage, from diagnosis to dispatch QC."
    >
      <div style={{ display: 'grid', gap: '16px' }}>
        {/* The stage strip IS the pipeline view. One screen, not six. */}
        <div className="flex flex-wrap overflow-x-auto">
          <Segmented
            label="Stage"
            value={stage}
            onChange={setStage}
            options={STAGE_GROUPS.map((s) => ({
              value: s.key,
              label: (
                <>
                  {s.label}
                  <span className="font-mono" style={{ opacity: 0.7 }}>
                    {pipeline.loading ? '·' : countFor(s.key)}
                  </span>
                </>
              ),
            }))}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gap: '12px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <StatTile label="On the floor" value={pipeline.loading ? null : countFor('')} />
          <StatTile label="Shown here" value={loading ? null : total} />
          <StatTile
            label="Escalated"
            value={loading ? null : escalated}
            family={escalated ? 'offcycle' : undefined}
            delta="third QC failure — off the rework loop"
          />
          <StatTile
            label="On security hold"
            value={loading ? null : held}
            family={held ? 'moving' : undefined}
          />
        </div>

        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={`${total} shown`}
            />
          )}
        >
          {loading && <EmptyState title="Loading…" />}
          {error && <EmptyState title="Could not load the floor" body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.ticket_id}
              empty={(
                <EmptyState
                  title={stage ? `Nothing at ${stage}` : 'Nothing on the floor'}
                  body="Filters combine, so clearing one at a time will show what is excluding them."
                  action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>}
                />
              )}
            />
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
