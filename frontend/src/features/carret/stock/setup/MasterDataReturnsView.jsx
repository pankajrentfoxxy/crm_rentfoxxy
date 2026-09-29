import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, DataTable, DocNumber, EmptyState, Input, Notice, Section, StatusChip, Tabs,
} from '../../../../components/carret';
import {
  exportReturnMasterExcel, fetchReturnMasterColumnValues, fetchReturnMasterLaptops, fetchReturnMasterOverview,
} from '../../../inventory-management/inventoryManagementApi';
import {
  clearColumnFilterParams, columnFiltersToParams, readColumnFiltersFromParams, RMD_COLUMN_TYPES,
} from '../../../inventory-management/returnMasterColumnFilters';
import { SPEC_FILTER_KEYS } from '../../../inventory-management/inventorySpecFilters';
import {
  ClickTile, ColumnFilterDrawer, currentMonthValue, DateModeControl, errMsg, fmtDate, fmtMoney, humanize,
  MultiSelect, PAGE_SIZE, Pager, readCsv, SpecFilters, TileGrid, useColumnFilters, useLoader, useSearchBox,
  useSpecParams, useUrlFilters, withColumnFilters,
} from './MasterDataShared';
import { WAREHOUSE_STAGE_CARDS } from './MasterDataVendorView';

/**
 * Master data → Returns (old /inventory-management/return-master-data,
 * section inventory_return_master_data). Laptops received back from
 * customers in a window (default: this month, by warehouse received date)
 * and where they are today: KPIs, return types, warehouse production,
 * customer-wise summary and the returned-laptop list.
 */
const URL_KEYS = [
  'view', 'page', 'tab', 'q', 'status', 'location', 'stage', 'return_type',
  'date_mode', 'month', 'date_from', 'date_to',
  'customer_id', 'warehouse_bucket',
  ...SPEC_FILTER_KEYS,
];
const STATUS_OPTIONS = [
  'in_stock', 'reserved', 'in_transit', 'rented', 'on_demo', 'sold',
  'returned', 'in_repair', 'qc_failed', 'scrapped', 'returned_to_vendor',
].map((s) => ({ value: s, label: humanize(s) }));
const LOCATION_OPTIONS = [
  { value: 'customer', label: 'With customer' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'repair', label: 'Vendor repair' },
  { value: 'other', label: 'Other' },
];
const STAGE_OPTIONS = [
  'QC1', 'QC2', 'Diagnosis', 'Chip Level Repair', 'Assembly & Software',
  'Final Testing', 'Dispatch QC', 'Floor Manager', 'Pending Inventory', 'Inventory',
];
const RETURN_TYPES = [
  { value: 'customer_return', label: 'Customer return' },
  { value: 'repair_pickup', label: 'Repair pickup' },
  { value: 'replacement_return', label: 'Replacement return' },
  { value: 'other', label: 'Other return' },
];
const RETURN_TYPE_LABEL = Object.fromEntries(RETURN_TYPES.map((o) => [o.value, o.label]));
const CF = { read: readColumnFiltersFromParams, toParams: columnFiltersToParams, clear: clearColumnFilterParams };
const stop = (e) => e.stopPropagation();

export default function MasterDataReturnsView() {
  const { sp, setSp, patch } = useUrlFilters(URL_KEYS);
  const [searchInput, setSearchInput] = useSearchBox(sp, patch);
  const cf = useColumnFilters(sp, setSp, CF);
  const specParams = useSpecParams(sp);
  const [exporting, setExporting] = useState(false);

  const tab = sp.get('tab') === 'laptops' ? 'laptops' : 'customers';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const csv = (k) => readCsv(sp, k);
  const locations = csv('location');
  const buckets = csv('warehouse_bucket');
  const returnTypes = csv('return_type');
  const months = csv('month');
  const dateFrom = sp.get('date_from') || '';
  const dateTo = sp.get('date_to') || '';
  // Default = this month, as on the old page; "All time" is stored as date_mode=all.
  const rawMode = sp.get('date_mode');
  const dateMode = rawMode === 'all' ? '' : (rawMode || (dateFrom || dateTo ? 'range' : 'month'));

  const key = sp.toString();
  const filterParams = useMemo(() => ({
    search: sp.get('q') || undefined,
    status: sp.get('status') || undefined,
    location: sp.get('location') || undefined,
    stage: sp.get('stage') || undefined,
    return_type: sp.get('return_type') || undefined,
    customer_id: sp.get('customer_id') || undefined,
    warehouse_bucket: sp.get('warehouse_bucket') || undefined,
    date_mode: dateMode || undefined,
    month: dateMode === 'month' ? (months.join(',') || currentMonthValue()) : undefined,
    date_from: dateMode === 'range' ? (dateFrom || undefined) : undefined,
    date_to: dateMode === 'range' ? (dateTo || undefined) : undefined,
    ...specParams,
  }), [key, specParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const listParams = useMemo(() => ({ ...filterParams, ...cf.params }), [filterParams, cf.params]);

  const [overview, ovLoading, , ovError] = useLoader(
    () => fetchReturnMasterOverview(filterParams).then(({ data }) => data),
    [JSON.stringify(filterParams)],
  );
  const [list, listLoading, , listError] = useLoader(
    () => fetchReturnMasterLaptops({ ...listParams, page, limit: PAGE_SIZE }).then(({ data }) => data),
    [JSON.stringify(listParams), page],
  );
  const fetchValues = useCallback(
    (column) => fetchReturnMasterColumnValues({ ...listParams, column }).then(({ data }) => data?.values || []),
    [listParams],
  );

  const k = overview?.kpis || {};
  const v = (x) => (ovLoading && !overview ? '…' : (x ?? 0));
  const stages = k.warehouse_stages || {};
  const typesKpi = k.return_types || {};
  const customers = overview?.customers || [];
  const totals = useMemo(() => customers.reduce((a, c) => {
    ['returned_qty', 'warehouse_qty', 'customer_qty', 'repair_qty', 'other_qty'].forEach((f) => { a[f] = (a[f] || 0) + Number(c[f] || 0); });
    return a;
  }, {}), [customers]);

  const clearAll = () => {
    setSearchInput('');
    setSp(new URLSearchParams({ view: 'returns', date_mode: 'month', month: currentMonthValue() }), { replace: true });
  };
  const exportExcel = async () => {
    setExporting(true);
    try { await exportReturnMasterExcel(listParams); toast.success('Export downloaded'); } catch (e) { toast.error(errMsg(e, 'Export failed')); } finally { setExporting(false); }
  };
  const toggleLocation = (loc) => patch({ location: locations.length === 1 && locations[0] === loc ? '' : loc, warehouse_bucket: '', tab: 'laptops' });
  const toggleBucket = (b) => patch({ warehouse_bucket: buckets.includes(b) ? '' : b, location: 'warehouse', tab: 'laptops' });
  const toggleType = (t) => patch({ return_type: returnTypes.length === 1 && returnTypes[0] === t ? '' : t, tab: 'laptops' });

  const laptopCols = withColumnFilters([
    { key: 'ttspl_id', header: 'TTSPL', render: (r) => (r.ttspl_id ? <Link to={`/carret/stock/assets/${encodeURIComponent(r.ttspl_id)}`} onClick={stop}><DocNumber value={r.ttspl_id} /></Link> : '—') },
    { key: 'serial_number', header: 'Serial', render: (r) => r.serial_number || '—' },
    { key: 'previous_customer_name', header: 'Returned by', render: (r) => r.previous_customer_name || '—' },
    { key: 'return_date', header: 'Returned', render: (r) => fmtDate(r.return_date) },
    { key: 'return_dc_number', header: 'Return DC', render: (r) => (r.return_dc_number ? <Link to={`/carret/move/return-challans/${encodeURIComponent(r.return_dc_number)}`} onClick={stop}><DocNumber value={r.return_dc_number} /></Link> : '—') },
    { key: 'return_type', header: 'Return type', render: (r) => RETURN_TYPE_LABEL[r.return_type] || r.return_type || '—' },
    { key: 'brand_model', header: 'Laptop', render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—' },
    { key: 'specs', header: 'Specs', render: (r) => [r.generation, r.processor, r.ram, r.storage, r.graphics, r.screen_size].filter(Boolean).join(' · ') || '—' },
    { key: 'current_status', header: 'Status now', render: (r) => (r.current_status ? <StatusChip status={r.current_status} /> : '—') },
    { key: 'current_location', header: 'Where now', render: (r) => r.location_label || r.current_location || '—' },
    { key: 'customer_name', header: 'Customer now', render: (r) => (r.customer_id ? <Link to={`/carret/sell/customers/${r.customer_id}`} onClick={stop}>{r.customer_name || `#${r.customer_id}`}</Link> : (r.customer_name || '—')) },
    { key: 'current_stage', header: 'Production stage', render: (r) => r.current_stage || '—' },
    { key: 'last_movement_date', header: 'Last movement', render: (r) => fmtDate(r.last_movement_date) },
  ], RMD_COLUMN_TYPES, cf);

  const customerRows = customers.length ? [...customers, { customer_id: '__total', customer_name: `Total (${customers.length})`, ...totals, isTotal: true }] : [];
  const customerCols = [
    {
      key: 'n',
      header: 'Customer',
      render: (c) => (c.isTotal ? <strong>{c.customer_name}</strong>
        : <Button variant="quiet" onClick={() => patch({ customer_id: String(c.customer_id), tab: 'laptops' })}>{c.customer_name || `#${c.customer_id}`}</Button>),
    },
    { key: 'r', header: 'Returned', numeric: true, render: (c) => c.returned_qty },
    { key: 'w', header: 'Warehouse', numeric: true, render: (c) => c.warehouse_qty },
    { key: 'c', header: 'With customer', numeric: true, render: (c) => c.customer_qty },
    { key: 'p', header: 'Repair', numeric: true, render: (c) => c.repair_qty },
    { key: 'o', header: 'Other', numeric: true, render: (c) => c.other_qty },
  ];

  return (
    <div className="c-stack">
      <Section title="Filters" actions={<><Button variant="quiet" onClick={clearAll}>Clear all</Button><Button onClick={exportExcel} disabled={exporting || listLoading}>{exporting ? 'Exporting…' : 'Export Excel'}</Button></>}>
        <div className="c-stack" style={{ gap: '10px' }}>
          <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
            <Input type="search" placeholder="TTSPL, serial, customer, return DC" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ maxWidth: '22rem' }} />
            <DateModeControl
              label="Received"
              mode={dateMode}
              months={months}
              from={dateFrom}
              to={dateTo}
              onChange={({ mode, months: m, from, to }) => {
                if (mode === 'month') patch({ date_mode: 'month', month: m || (months.length ? months : currentMonthValue()), date_from: '', date_to: '' });
                else if (mode === 'range') patch({ date_mode: 'range', month: '', date_from: from ?? dateFrom, date_to: to ?? dateTo });
                else patch({ date_mode: 'all', month: '', date_from: '', date_to: '' });
              }}
            />
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
            <MultiSelect label="Customer" options={overview?.customer_options || []} value={csv('customer_id')} onChange={(x) => patch({ customer_id: x })} />
            <MultiSelect label="Status" options={STATUS_OPTIONS} value={csv('status')} onChange={(x) => patch({ status: x })} />
            <MultiSelect label="Where now" options={LOCATION_OPTIONS} value={locations} onChange={(x) => patch({ location: x })} />
            <MultiSelect label="Stage" options={STAGE_OPTIONS} value={csv('stage')} onChange={(x) => patch({ stage: x })} />
            <MultiSelect label="Return type" options={RETURN_TYPES} value={returnTypes} onChange={(x) => patch({ return_type: x })} />
          </div>
          <SpecFilters sp={sp} patch={patch} />
          <p className="text-ink-3">Counted by warehouse received date (or the return date where inward is missing). Tiles show where those laptops are today.</p>
          {cf.count > 0 && <Button variant="quiet" onClick={cf.clearAll}>Clear {cf.count} column filter(s)</Button>}
        </div>
      </Section>

      {ovError && <Notice tone="crit" title="Could not load the overview">{ovError}</Notice>}
      <TileGrid>
        <ClickTile label="Total returned" value={v(k.total_returned)} hint="Received in the period" />
        <ClickTile label="Return value" value={ovLoading && !overview ? '…' : fmtMoney(k.total_return_value)} hint="Purchase rate of returned units" />
        <ClickTile label="With customer" value={v(k.customer_count)} family="earning" hint="Out again after return" onClick={() => toggleLocation('customer')} active={locations.length === 1 && locations[0] === 'customer'} />
        <ClickTile label="Warehouse" value={v(k.warehouse_count)} family="idle" hint="In warehouse / floor" onClick={() => toggleLocation('warehouse')} active={locations.length === 1 && locations[0] === 'warehouse'} />
        <ClickTile label="Vendor repair" value={v(k.out_for_repair_count)} family="offcycle" onClick={() => toggleLocation('repair')} active={locations.length === 1 && locations[0] === 'repair'} />
        <ClickTile label="Other" value={v(k.other_count)} hint="Not customer / warehouse / repair" onClick={() => toggleLocation('other')} active={locations.length === 1 && locations[0] === 'other'} />
      </TileGrid>

      <Section title="Return type">
        <TileGrid>
          {RETURN_TYPES.map((t) => <ClickTile key={t.value} label={t.label} value={v(typesKpi[t.value])} onClick={() => toggleType(t.value)} active={returnTypes.length === 1 && returnTypes[0] === t.value} />)}
        </TileGrid>
      </Section>

      <Section title="Warehouse production">
        <TileGrid min="9rem">
          {WAREHOUSE_STAGE_CARDS.map((c) => <ClickTile key={c.key} label={c.label} value={v(stages[c.key])} onClick={() => toggleBucket(c.key)} active={buckets.length === 1 && buckets[0] === c.key} />)}
        </TileGrid>
      </Section>

      <Tabs
        tabs={[
          { key: 'customers', label: 'By customer', count: ovLoading && !overview ? null : customers.length },
          { key: 'laptops', label: 'Returned laptops', count: listLoading && !list ? null : (list?.pagination?.total || 0) },
        ]}
        value={tab}
        onChange={(t) => patch({ tab: t }, { resetPage: t !== 'laptops' })}
      />

      {tab === 'customers' && (ovLoading && !overview ? <EmptyState title="Loading…" /> : (
        <DataTable columns={customerCols} rows={customerRows} rowKey={(c) => c.customer_id} empty={<EmptyState title="No customer returns in this period" />} />
      ))}
      {tab === 'laptops' && (
        <div className="c-stack">
          {listError && <Notice tone="crit" title="Could not load returned laptops">{listError}</Notice>}
          {listLoading && !list ? <EmptyState title="Loading…" /> : (
            <DataTable columns={laptopCols} rows={list?.data || []} rowKey={(r) => r.serial_id} empty={<EmptyState title="No returned laptops in this period" />} />
          )}
          <Pager page={page} totalPages={list?.pagination?.totalPages} total={list?.pagination?.total} onPage={(p) => patch({ page: p }, { resetPage: false })} />
        </div>
      )}

      <ColumnFilterDrawer
        column={cf.openCol}
        type={cf.openCol ? RMD_COLUMN_TYPES[cf.openCol.key] : null}
        current={cf.openCol ? cf.filters[cf.openCol.key] : null}
        fetchValues={fetchValues}
        onApply={(f) => { cf.apply(cf.openCol.key, f); cf.setOpenCol(null); }}
        onClose={() => cf.setOpenCol(null)}
      />
    </div>
  );
}
