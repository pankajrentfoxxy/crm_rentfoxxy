import React, { useState, useMemo, useCallback } from 'react';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, FilterBar, Panel, StatusChip, DocNumber, DateTime, EmptyState, Button, Money,
} from '../../components/carret';
import { useChallans, useGatePreflight } from './useDeliveryChallans';

/**
 * Move → Delivery Challans and Return Challans (Part 3.7).
 *
 * One screen, two movements, because a challan is a challan — splitting them
 * into separate pages is how the same document ended up with two sets of
 * screens that drifted apart.
 *
 * The pre-flight panel is here as well as on the gate: the person who can fix a
 * missing e-way bill is at a desk, not on the loading bay, and they should be
 * able to see the problem before the guard hits it.
 */
const STATUSES = [
  'pending', 'dispatch_ready', 'in_transit', 'reached', 'delivered', 'rejected', 'cancelled',
];

export default function ChallansPage({ movement = 'outbound' }) {
  const [filters, setFilters] = useState({});
  const [inspecting, setInspecting] = useState(null);

  const { loading, error, rows, total } = useChallans({
    movement,
    status: filters.status || '',
    search: filters.search || '',
  });

  const preflight = useGatePreflight(inspecting);

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => setFilters({}), []);

  const filterDefs = useMemo(() => [
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Challan or customer' },
    { key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })) },
  ], []);

  const columns = useMemo(() => [
    { key: 'dc_number', header: 'Challan', render: (r) => <DocNumber value={r.dc_number} /> },
    { key: 'customer_name', header: 'Customer' },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
    { key: 'dispatch_mode', header: 'Mode' },
    { key: 'awb_number', header: 'AWB', render: (r) => (r.awb_number ? <DocNumber value={r.awb_number} /> : '—') },
    { key: 'delivered_at', header: 'Delivered', render: (r) => <DateTime value={r.delivered_at} /> },
    {
      key: 'preflight',
      header: 'Gate',
      render: (r) => (r.status === 'dispatch_ready'
        ? (
          <Button
            variant="quiet"
            onClick={(e) => { e.stopPropagation(); setInspecting(r.dc_number); }}
          >
            Check
          </Button>
        )
        : <span className="text-ink-3">—</span>),
    },
  ], []);

  return (
    <DeskShell
      title={movement === 'return' ? 'Return Challans' : 'Delivery Challans'}
      breadcrumb="Move"
      subtitle={movement === 'return' ? 'Units coming back in from customers, one challan at a time.' : 'Challans leaving the warehouse, with a gate pre-flight before anything goes out.'}
    >
      <div style={{ display: 'grid', gap: '16px' }}>
        {inspecting && (
          <section
            className="c-card"
            style={{
              padding: '16px',
              borderColor: preflight.ok === false ? 'var(--alert-crit)' : 'var(--rule)',
            }}
          >
            <div className="flex items-baseline flex-wrap" style={{ gap: 'var(--d-pad-x)' }}>
              <h3 className="font-ui text-ink m-0" style={{ fontSize: 'var(--d-base)', fontWeight: 600 }}>
                Gate pre-flight — <DocNumber value={inspecting} />
              </h3>
              {preflight.loading && <span className="font-ui text-ink-3">checking…</span>}
              {preflight.ok === true && <span className="font-ui" style={{ color: 'var(--alert-good)' }}>Clear to go out</span>}
              <Button variant="quiet" className="ml-auto" onClick={() => setInspecting(null)}>Close</Button>
            </div>

            {preflight.ok === false && (
              <ul className="list-none p-0" style={{ marginTop: 'var(--d-gap)' }}>
                {preflight.failures.map((f) => (
                  <li key={f.code} className="font-ui" style={{ color: 'var(--alert-crit)', padding: 'var(--d-pad-y) 0' }}>
                    {f.message}
                  </li>
                ))}
              </ul>
            )}
            {preflight.error && <div className="font-ui text-ink-2">{preflight.error}</div>}
          </section>
        )}

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
          {error && <EmptyState title="Could not load challans" body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r, i) => r.dc_number ?? i}
              empty={<EmptyState
                title="No challans match"
                body="Filters combine, so clearing one at a time will show what is excluding them."
                action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>}
              />}
            />
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
