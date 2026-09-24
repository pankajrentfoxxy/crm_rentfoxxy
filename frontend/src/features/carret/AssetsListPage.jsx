import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, FilterBar, Panel, StatusChip, DocNumber, Money, DateTime, EmptyState, Button, Segmented,
} from '../../components/carret';
import { ASSET_STATUSES } from '../../config/statuses';
import { useAssetList } from './useAssets';

/**
 * Stock → Assets (Part 2.7).
 *
 * Filters COMBINE. The current screens replace one filter with the next, which
 * is why people export to a spreadsheet to answer a two-dimensional question
 * like "Dell laptops in repair". Here vendor + status + search is an
 * intersection.
 *
 * The status options come from the canonical twelve, so this list cannot invent
 * a thirteenth the way every screen used to.
 */
const SEGMENTS = [
  { key: 'passed', label: 'Ready to rent or sell' },
  { key: 'rented', label: 'With customers' },
  { key: 'qc_pending', label: 'Awaiting QC' },
  { key: 'dead_laptops', label: 'Scrapped' },
];

export default function AssetsListPage() {
  const navigate = useNavigate();
  const [segment, setSegment] = useState('passed');
  const [filters, setFilters] = useState({});

  const { loading, error, rows, total } = useAssetList({ segment, filters });

  const onFilter = useCallback((key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);
  const onClear = useCallback(() => setFilters({}), []);

  const filterDefs = useMemo(() => [
    { key: 'search', label: 'Search', type: 'search', placeholder: 'TTSPL or serial' },
    { key: 'brand', label: 'Brand', options: [
      { value: 'Dell', label: 'Dell' }, { value: 'HP', label: 'HP' },
      { value: 'Lenovo', label: 'Lenovo' }, { value: 'Apple', label: 'Apple' },
    ] },
    { key: 'status', label: 'Status', options: ASSET_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
  ], []);

  const columns = useMemo(() => [
    {
      key: 'ttspl',
      header: 'TTSPL',
      render: (r) => <DocNumber value={r.inventory_asset_code || r.ttspl_id || r.unique_product_serial} />,
    },
    { key: 'serial_number', header: 'Serial' },
    {
      key: 'config',
      header: 'Configuration',
      render: (r) => [r.brand, r.model || r.pd_model, r.processor, r.ram, r.storage]
        .filter(Boolean).join(' · ') || '—',
    },
    {
      key: 'inventory_status',
      header: 'State',
      render: (r) => (r.inventory_status
        ? <StatusChip status={r.inventory_status} />
        // Decision D1 made visible: NULL is not a gap, it is "not yet through GRN".
        : <span className="text-ink-3 font-ui">awaiting GRN</span>),
    },
    { key: 'rent_monthly_rate', header: 'Rent', numeric: true, render: (r) => <Money value={r.rent_monthly_rate} showZero={false} /> },
    { key: 'updated_at', header: 'Updated', render: (r) => <DateTime value={r.updated_at} /> },
  ], []);

  const open = useCallback((row) => {
    const code = row.inventory_asset_code || row.ttspl_id || row.unique_product_serial || row.serial_number;
    if (code) navigate(`/carret/stock/assets/${encodeURIComponent(code)}`);
  }, [navigate]);

  return (
    <DeskShell
      title="Assets"
      breadcrumb="Stock"
      subtitle="Every laptop by TTSPL code: where it is, what state it is in, and what it earns."
    >
      <div style={{ display: 'grid', gap: '16px' }}>
        <div className="flex flex-wrap">
          <Segmented
            label="Segment"
            value={segment}
            onChange={setSegment}
            options={SEGMENTS.map((s) => ({ value: s.key, label: s.label }))}
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
          {error && <EmptyState title="Could not load assets" body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r, i) => r.serial_id ?? i}
              onRowClick={open}
              empty={<EmptyState
                title="No assets match"
                body="Every filter here combines, so narrowing one at a time will show what is excluding them."
                action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>}
              />}
            />
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
