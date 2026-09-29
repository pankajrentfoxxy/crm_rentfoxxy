import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Money, Panel, StatTile,
} from '../../../../components/carret';
import useDebouncedValue from '../../../../hooks/useDebouncedValue';
import { UnitStatus } from './PartRecordDrawer';
import {
  CATEGORY_LABEL, UNIT_STATUS_OPTIONS, errMsg, fitsSummary, listPartInstances, partCategory,
} from './partsApi';

const LIMIT = 500;

/**
 * Every tracked spare unit, newest first: what is on the shelf, what is fitted
 * and into which laptop, which PO it came on. "Fits" filters are the laptop
 * fitment tagged at GRN (the old list's brand/model filter sent the spare's own
 * brand while its options were laptop brands, so it rarely matched).
 */
export default function PartUnitsTab({ onOpenPart, onPrint, refreshKey }) {
  const [filters, setFilters] = useState({});
  const search = useDebouncedValue((filters.search || '').trim(), 320);
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState({});

  const load = useCallback(() => {
    setData(null);
    listPartInstances({
      search: search || undefined,
      status: filters.status || undefined,
      category: filters.category || undefined,
      fits_laptop_brand: filters.brand || undefined,
      fits_laptop_model: filters.model || undefined,
      limit: LIMIT,
    })
      .then(({ data: d }) => setData(d))
      .catch((e) => { setData({ instances: [], filters: {} }); toast.error(errMsg(e)); });
  }, [search, filters.status, filters.category, filters.brand, filters.model]);
  useEffect(() => { load(); setPicked({}); }, [load, refreshKey]);

  const rows = useMemo(() => data?.instances || [], [data]);
  const opts = data?.filters || {};
  const modelsForBrand = filters.brand ? (opts.models_by_brand?.[filters.brand] || []) : (opts.models || []);

  const onFilter = useCallback((k, v) => setFilters((f) => (k === 'brand' ? { ...f, brand: v, model: '' } : { ...f, [k]: v })), []);
  const filterDefs = [
    { key: 'search', type: 'search', label: 'Search', placeholder: 'Part ID, serial, part, TTSPL, PO, vendor, shelf' },
    { key: 'status', label: 'State', options: UNIT_STATUS_OPTIONS },
    { key: 'category', label: 'Category', options: (opts.categories || []).map((c) => ({ value: c, label: CATEGORY_LABEL[c] || c })) },
    { key: 'brand', label: 'Fits brand', options: (opts.brands || []).map((b) => ({ value: b, label: b })) },
    { key: 'model', label: 'Fits model', options: modelsForBrand.map((m) => ({ value: m, label: m })) },
  ];

  const chosen = rows.filter((r) => picked[r.instance_id] && r.prt_id);
  const cols = [
    {
      key: 'pick',
      header: '',
      width: '2.5rem',
      render: (r) => (r.prt_id ? (
        <input
          type="checkbox"
          aria-label={`Pick ${r.prt_id} for labels`}
          checked={Boolean(picked[r.instance_id])}
          onClick={(e) => e.stopPropagation()}
          onChange={() => setPicked((p) => ({ ...p, [r.instance_id]: !p[r.instance_id] }))}
        />
      ) : null),
    },
    { key: 'prt', header: 'Part ID', render: (r) => <DocNumber value={r.prt_id} />, sub: (r) => r.serial_number || 'no serial' },
    { key: 'part', header: 'Part', render: (r) => r.part_name, sub: (r) => CATEGORY_LABEL[partCategory(r)] || r.category },
    { key: 'fits', header: 'Fits', render: (r) => fitsSummary(r), sub: (r) => (r.brand_name ? `part brand ${r.brand_name}` : null) },
    { key: 'st', header: 'State', render: (r) => <UnitStatus status={r.status} /> },
    {
      key: 'in',
      header: 'Fitted to',
      render: (r) => (r.installed_ttspl_id
        ? <Link to={`/carret/stock/assets/${encodeURIComponent(r.installed_ttspl_id)}`} onClick={(e) => e.stopPropagation()}><DocNumber value={r.installed_ttspl_id} /></Link>
        : '—'),
      sub: (r) => (r.installed_at ? <DateTime value={r.installed_at} /> : null),
    },
    {
      key: 'po',
      header: 'Came on',
      render: (r) => (r.spo_id
        ? <Link to={`/carret/procure/spare-parts-orders/${r.spo_id}`} onClick={(e) => e.stopPropagation()}><DocNumber value={r.purchase_order_number || `SPO-${r.spo_id}`} /></Link>
        : (r.source === 'defective_return' ? 'From a laptop' : r.source === 'manual' ? 'Added by hand' : '—')),
      sub: (r) => r.vendor_name,
    },
    { key: 'loc', header: 'Shelf', render: (r) => r.location_code || '—' },
    { key: 'cost', header: 'Cost', numeric: true, render: (r) => <Money value={r.unit_cost} showZero={false} /> },
    { key: 'rcv', header: 'Received', render: (r) => <DateTime value={r.received_at || r.created_at} /> },
    {
      key: 'lbl',
      header: '',
      render: (r) => (r.prt_id ? <Button variant="quiet" onClick={(e) => { e.stopPropagation(); onPrint([r]); }}>Label</Button> : null),
    },
  ];

  const count = (s) => rows.filter((r) => r.status === s).length;
  return (
    <div className="c-stack">
      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <StatTile label="Shown" value={data ? rows.length : null} delta={rows.length >= LIMIT ? `first ${LIMIT} — narrow the filters` : undefined} />
        <StatTile label="In stock" value={data ? count('in_stock') : null} family="idle" />
        <StatTile label="Reserved" value={data ? count('reserved') : null} family="moving" />
        <StatTile label="Fitted" value={data ? count('installed') : null} family="earning" />
        <StatTile label="Defective" value={data ? count('defective') : null} family={count('defective') ? 'offcycle' : undefined} />
      </div>
      <Panel
        toolbar={(
          <FilterBar
            filters={filterDefs}
            values={filters}
            onChange={onFilter}
            onClear={() => setFilters({})}
            count={data ? `${rows.length} shown` : ''}
            right={chosen.length ? <Button variant="primary" onClick={() => onPrint(chosen)}>Print {chosen.length} label{chosen.length === 1 ? '' : 's'}</Button> : null}
          />
        )}
      >
        {data === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(r) => r.instance_id}
            onRowClick={(r) => onOpenPart(r.part_id)}
            empty={<EmptyState title="No units match" body="Filters combine — clear one at a time to see what excludes them." />}
          />
        )}
      </Panel>
    </div>
  );
}
