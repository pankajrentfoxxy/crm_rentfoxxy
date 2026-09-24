import React, { useMemo, useState, useCallback } from 'react';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, FilterBar, Panel, StatusChip, DocNumber, DateTime, Money, EmptyState, Button, StatTile,
} from '../../components/carret';
import { usePartInstances } from './useProduce';

/**
 * Parts (Part 5.7).
 *
 * Every tracked spare unit, with the brand and model the spare chain now
 * carries. Before the Brand → Model master, "model" on a received spare was the
 * part name wearing a model's label, so this list could not answer "which 65W
 * adapters, and which model" — the question a technician actually has.
 *
 * The brand and model dropdowns are built from the whole of stock, not from the
 * rows currently shown. A filter list that narrows as you filter tells you what
 * you have already excluded, which is the opposite of useful.
 */

const STATUSES = ['in_stock', 'reserved', 'installed', 'scrapped', 'returned'];

export default function PartsListPage() {
  const [filters, setFilters] = useState({});

  const { loading, error, rows, filterOptions } = usePartInstances({
    status: filters.status || undefined,
    brand: filters.brand || undefined,
    model: filters.model || undefined,
    category: filters.category || undefined,
    search: filters.search || undefined,
    limit: 300,
  });

  const onFilter = useCallback((k, v) => setFilters((f) => {
    // Changing the brand invalidates a model chosen under the previous one.
    if (k === 'brand') return { ...f, brand: v, model: '' };
    return { ...f, [k]: v };
  }), []);
  const onClear = useCallback(() => setFilters({}), []);

  const modelsForBrand = useMemo(() => {
    const byBrand = filterOptions.models_by_brand || {};
    if (filters.brand && byBrand[filters.brand]) return byBrand[filters.brand];
    return filterOptions.models || [];
  }, [filterOptions, filters.brand]);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'PRT, serial, part or TTSPL' },
    {
      key: 'brand',
      label: 'Brand',
      options: (filterOptions.brands || []).map((b) => ({ value: b, label: b })),
    },
    {
      key: 'model',
      label: 'Model',
      options: modelsForBrand.map((m) => ({ value: m, label: m })),
    },
    {
      key: 'category',
      label: 'Category',
      options: (filterOptions.categories || []).map((c) => ({ value: c, label: c })),
    },
    { key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })) },
  ]), [filterOptions, modelsForBrand]);

  const columns = useMemo(() => [
    { key: 'prt_id', header: 'Part ID', render: (r) => <DocNumber value={r.prt_id} /> },
    { key: 'part_name', header: 'Part' },
    {
      key: 'brand_model',
      header: 'Brand / Model',
      render: (r) => {
        const b = r.brand_name || r.brand;
        const m = r.model_name || r.model;
        if (!b && !m) return <span className="text-ink-3">unmapped</span>;
        return <span>{[b, m].filter(Boolean).join(' · ')}</span>;
      },
    },
    { key: 'serial_number', header: 'Serial', render: (r) => r.serial_number || <span className="text-ink-3">—</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
    {
      key: 'installed_ttspl_id',
      header: 'Fitted to',
      render: (r) => (r.installed_ttspl_id
        ? <DocNumber value={r.installed_ttspl_id} />
        : <span className="text-ink-3">—</span>),
    },
    { key: 'location_code', header: 'Location', render: (r) => r.location_code || <span className="text-ink-3">—</span> },
    { key: 'unit_cost', header: 'Cost', numeric: true, render: (r) => <Money value={r.unit_cost} showZero={false} /> },
    { key: 'received_at', header: 'Received', render: (r) => <DateTime value={r.received_at || r.created_at} /> },
  ], []);

  const inStock = rows.filter((r) => r.status === 'in_stock').length;
  const installed = rows.filter((r) => r.status === 'installed').length;
  const unmapped = rows.filter((r) => !(r.brand_name || r.brand)).length;

  return (
    <DeskShell
      title="Parts"
      breadcrumb="Produce"
      subtitle="Spare-part units: what is on the shelf, what is fitted, and into which laptop."
    >
      <div style={{ display: 'grid', gap: '16px' }}>
        <div
          style={{
            display: 'grid',
            gap: '12px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <StatTile label="Shown" value={loading ? null : rows.length} />
          <StatTile label="In stock" value={loading ? null : inStock} family="idle" />
          <StatTile label="Fitted" value={loading ? null : installed} family="earning" />
          <StatTile
            label="No brand on record"
            value={loading ? null : unmapped}
            family={unmapped ? 'offcycle' : undefined}
            delta="received before the brand/model master"
          />
        </div>

        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={`${rows.length} shown`}
            />
          )}
        >
          {loading && <EmptyState title="Loading…" />}
          {error && <EmptyState title="Could not load parts" body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.instance_id}
              empty={(
                <EmptyState
                  title="No parts match"
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
