import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, DataTable, DocNumber, EmptyState, Input, Notice, Section, StatusChip,
} from '../../../../components/carret';
import {
  exportVendorMasterExcel, fetchVendorMasterColumnValues, fetchVendorMasterLaptops, fetchVendorMasterOverview,
} from '../../../inventory-management/inventoryManagementApi';
import {
  clearColumnFilterParams, columnFiltersToParams, readColumnFiltersFromParams, VMD_COLUMN_TYPES,
} from '../../../inventory-management/vendorMasterColumnFilters';
import { SPEC_FILTER_KEYS } from '../../../inventory-management/inventorySpecFilters';
import {
  ClickTile, ColumnFilterDrawer, currentMonthValue, DateModeControl, errMsg, fmtDate, fmtMoney, humanize,
  MultiSelect, PAGE_SIZE, Pager, readCsv, SpecFilters, TileGrid, useColumnFilters, useLoader, useSearchBox,
  useSpecParams, useUrlFilters, withColumnFilters,
} from './MasterDataShared';

/**
 * Master data → Vendor purchases (old /inventory-management/vendor-master-data,
 * section inventory_vendor_master_data). The laptops bought in a purchase-date
 * window (default: this month) and what became of them: sold, rented,
 * warehouse, repair, returned, replacements, rental-purchase breakup,
 * warehouse production stages, vendor summary, the laptop list.
 */
const URL_KEYS = [
  'view', 'page', 'q', 'status', 'location', 'stage', 'pricing_type',
  'purchase_type', 'customer_id', 'rental_lifecycle',
  'date_mode', 'month', 'date_from', 'date_to',
  'purchase_date_mode', 'purchase_month', 'purchase_date_from', 'purchase_date_to',
  'activity_date_mode', 'activity_month', 'activity_date_from', 'activity_date_to',
  'vendor_id', 'usage_bucket', 'warehouse_bucket', 'intake_type',
  ...SPEC_FILTER_KEYS,
];
const STATUS_OPTIONS = [
  'in_stock', 'reserved', 'in_transit', 'rented', 'on_demo', 'sold',
  'returned', 'in_repair', 'qc_failed', 'scrapped', 'returned_to_vendor',
].map((s) => ({ value: s, label: humanize(s) }));
const LOCATION_OPTIONS = [
  { value: 'Customer', label: 'Customer' },
  { value: 'Inventory', label: 'Warehouse / Inventory' },
  { value: 'Floor', label: 'Floor / Production' },
  { value: 'Vendor', label: 'Vendor repair' },
];
const STAGE_OPTIONS = [
  'QC1', 'QC2', 'Diagnosis', 'Chip Level Repair', 'Assembly & Software',
  'Final Testing', 'Dispatch QC', 'Floor Manager', 'Pending Inventory', 'Inventory',
];
const PRICING_OPTIONS = [{ value: 'sale', label: 'Sale' }, { value: 'rental', label: 'Rental' }];
const DEFAULT_PURCHASE_TYPES = [
  { value: 'rental_purchase', label: 'Rental Purchase' },
  { value: 'rent_to_own', label: 'Rent to Own' },
  { value: 'direct_purchase', label: 'Direct Purchase' },
];
export const WAREHOUSE_STAGE_CARDS = [
  { key: 'qc1', label: 'QC1' },
  { key: 'qc2', label: 'QC2' },
  { key: 'diagnosis_hardware', label: 'Diagnosis — hardware' },
  { key: 'diagnosis_software', label: 'Diagnosis — software' },
  { key: 'final_testing', label: 'Final testing' },
  { key: 'ready_to_rent', label: 'Ready to rent' },
  { key: 'ready_to_sell', label: 'Ready to sell' },
  { key: 'dead_scrapped', label: 'Dead / scrapped' },
  { key: 'other', label: 'Other' },
];
const CF = { read: readColumnFiltersFromParams, toParams: columnFiltersToParams, clear: clearColumnFilterParams };
const stop = (e) => e.stopPropagation();

function AssetLink({ id }) {
  if (!id) return '—';
  return <Link to={`/carret/stock/assets/${encodeURIComponent(id)}`} onClick={stop}><DocNumber value={id} /></Link>;
}

export default function MasterDataVendorView() {
  const { sp, setSp, patch } = useUrlFilters(URL_KEYS);
  const [searchInput, setSearchInput] = useSearchBox(sp, patch);
  const cf = useColumnFilters(sp, setSp, CF);
  const specParams = useSpecParams(sp);
  const [exporting, setExporting] = useState(false);

  const page = Math.max(1, Number(sp.get('page')) || 1);
  const csv = (k) => readCsv(sp, k);
  const statuses = csv('status');
  const purchaseTypes = csv('purchase_type');
  const usage = csv('usage_bucket');
  const buckets = csv('warehouse_bucket');
  const rentalLifecycle = sp.get('rental_lifecycle') || '';
  const intakeType = sp.get('intake_type') || '';

  // Purchase date: default this month (the old page's default); legacy date_* keys still read.
  const pFrom = sp.get('purchase_date_from') || sp.get('date_from') || '';
  const pTo = sp.get('purchase_date_to') || sp.get('date_to') || '';
  const rawPMode = sp.get('purchase_date_mode') || sp.get('date_mode') || '';
  const pMode = rawPMode === 'all' ? 'all' : (['month', 'range'].includes(rawPMode) ? rawPMode : (pFrom || pTo ? 'range' : 'month'));
  const pMonths = csv('purchase_month').length ? csv('purchase_month') : csv('month');
  const aFrom = sp.get('activity_date_from') || '';
  const aTo = sp.get('activity_date_to') || '';
  const rawAMode = sp.get('activity_date_mode') || '';
  const aMode = ['month', 'range', 'all'].includes(rawAMode) ? rawAMode : (aFrom || aTo ? 'range' : 'all');
  const aMonths = csv('activity_month');

  const key = sp.toString();
  const filterParams = useMemo(() => ({
    search: sp.get('q') || undefined,
    status: sp.get('status') || undefined,
    location: sp.get('location') || undefined,
    stage: sp.get('stage') || undefined,
    pricing_type: sp.get('pricing_type') || undefined,
    purchase_type: sp.get('purchase_type') || undefined,
    customer_id: sp.get('customer_id') || undefined,
    rental_lifecycle: rentalLifecycle || undefined,
    vendor_id: sp.get('vendor_id') || undefined,
    usage_bucket: sp.get('usage_bucket') || undefined,
    warehouse_bucket: sp.get('warehouse_bucket') || undefined,
    purchase_date_mode: pMode,
    purchase_month: pMode === 'month' ? (pMonths.join(',') || currentMonthValue()) : undefined,
    purchase_date_from: pMode === 'range' ? (pFrom || undefined) : undefined,
    purchase_date_to: pMode === 'range' ? (pTo || undefined) : undefined,
    activity_date_mode: aMode === 'all' ? undefined : aMode,
    activity_month: aMode === 'month' ? (aMonths.join(',') || undefined) : undefined,
    activity_date_from: aMode === 'range' ? (aFrom || undefined) : undefined,
    activity_date_to: aMode === 'range' ? (aTo || undefined) : undefined,
    intake_type: intakeType || undefined,
    ...specParams,
  }), [key, specParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const overviewParams = useMemo(() => { const n = { ...filterParams }; delete n.rental_lifecycle; return n; }, [filterParams]);
  const listParams = useMemo(() => ({ ...filterParams, ...cf.params }), [filterParams, cf.params]);

  const [overview, ovLoading, , ovError] = useLoader(
    () => fetchVendorMasterOverview(overviewParams).then(({ data }) => data),
    [JSON.stringify(overviewParams)],
  );
  const [list, listLoading, , listError] = useLoader(
    () => fetchVendorMasterLaptops({ ...listParams, page, limit: PAGE_SIZE }).then(({ data }) => data),
    [JSON.stringify(listParams), page],
  );
  const fetchValues = useCallback(
    (column) => fetchVendorMasterColumnValues({ ...listParams, column }).then(({ data }) => data?.values || []),
    [listParams],
  );

  const k = overview?.kpis || {};
  const v = (x) => (ovLoading && !overview ? '…' : (x ?? 0));
  const money = (x) => (ovLoading && !overview ? '…' : fmtMoney(x));
  const stages = k.warehouse_stages || {};
  const vendors = overview?.vendors || [];
  const purchaseTypeOptions = overview?.purchase_type_options?.length ? overview.purchase_type_options : DEFAULT_PURCHASE_TYPES;

  const totals = useMemo(() => vendors.reduce((a, x) => {
    ['purchased_qty', 'purchase_value', 'sold_qty', 'sale_value', 'rental_qty', 'monthly_rental_value', 'warehouse_qty', 'returned_qty', 'repair_qty', 'current_total']
      .forEach((f) => { a[f] = (a[f] || 0) + Number(x[f] || 0); });
    return a;
  }, {}), [vendors]);

  const clearAll = () => {
    setSearchInput('');
    setSp(new URLSearchParams({ view: 'vendor', purchase_date_mode: 'month', purchase_month: currentMonthValue() }), { replace: true });
  };
  const exportExcel = async () => {
    setExporting(true);
    try { await exportVendorMasterExcel(listParams); toast.success('Export downloaded'); } catch (e) { toast.error(errMsg(e, 'Export failed')); } finally { setExporting(false); }
  };

  const toggleUsage = (b) => patch({ usage_bucket: usage.includes(b) ? '' : b, warehouse_bucket: '', intake_type: '', status: '' });
  const toggleBucket = (b) => patch({ warehouse_bucket: buckets.includes(b) ? '' : b, usage_bucket: '' });
  const lifecycle = (key2) => patch({
    purchase_type: purchaseTypes.includes('rental_purchase') ? purchaseTypes : [...purchaseTypes, 'rental_purchase'],
    rental_lifecycle: rentalLifecycle === key2 ? '' : key2,
  });
  const allActive = !usage.length && !buckets.length && !intakeType && !rentalLifecycle && !statuses.length;
  const returnedActive = statuses.length === 1 && statuses[0] === 'returned';

  const laptopCols = withColumnFilters([
    {
      key: 'ttspl_id',
      header: 'TTSPL',
      render: (r) => {
        if (r.is_replacement_intake && r.replaced_ttspl_id) return <span><AssetLink id={r.replaced_ttspl_id} /> → <AssetLink id={r.ttspl_id} /></span>;
        if (r.ttspl_display && r.ttspl_display.includes(' -> ')) return <span><AssetLink id={r.ttspl_id} /> → <AssetLink id={r.latest_replacement_ttspl} /></span>;
        return <AssetLink id={r.ttspl_id} />;
      },
    },
    { key: 'serial_number', header: 'Serial', render: (r) => r.serial_number || '—' },
    { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || '—' },
    { key: 'purchase_date', header: 'Purchased', render: (r) => fmtDate(r.purchase_date) },
    { key: 'sold_date', header: 'Sold', render: (r) => fmtDate(r.sold_date) },
    {
      key: 'purchase_order_number',
      header: 'PO',
      render: (r) => (r.po_id && r.purchase_order_number ? <Link to={`/carret/procure/purchase-orders/${r.po_id}`} onClick={stop}><DocNumber value={r.purchase_order_number} /></Link> : (r.purchase_order_number || '—')),
    },
    { key: 'purchase_rate', header: 'Purchase rate', numeric: true, render: (r) => (r.purchase_rate != null ? fmtMoney(r.purchase_rate) : '—') },
    { key: 'brand', header: 'Brand', render: (r) => r.brand || '—' },
    { key: 'model', header: 'Model', render: (r) => r.model || '—' },
    { key: 'specs', header: 'Specs', render: (r) => [r.processor, r.generation, r.ram, r.storage, r.graphics, r.screen_size].filter(Boolean).join(' · ') || '—' },
    { key: 'current_status', header: 'Status', render: (r) => (r.current_status ? <StatusChip status={r.current_status} /> : '—') },
    { key: 'location_label', header: 'Location', render: (r) => r.location_label || r.current_location || '—' },
    { key: 'current_stage', header: 'Stage', render: (r) => r.current_stage || '—' },
    { key: 'customer_name', header: 'Customer', render: (r) => (r.customer_id ? <Link to={`/carret/sell/customers/${r.customer_id}`} onClick={stop}>{r.customer_name || `#${r.customer_id}`}</Link> : (r.customer_name || '—')) },
    {
      key: 'so_dc',
      header: 'SO / DC',
      render: (r) => (r.sales_order_number ? <Link to={`/carret/sell/sales-orders/${encodeURIComponent(r.sales_order_number)}`} onClick={stop}><DocNumber value={r.sales_order_number} /></Link> : '—'),
      sub: (r) => r.delivery_challan_number || null,
    },
    {
      key: 'sale_rent',
      header: 'Sale / rent',
      numeric: true,
      render: (r) => {
        if (r.sale_price != null) return `${fmtMoney(r.sale_price)} sale`;
        if (r.customer_monthly_rate != null) return `${fmtMoney(r.customer_monthly_rate)}/mo`;
        return '—';
      },
    },
    { key: 'last_movement_date', header: 'Last movement', render: (r) => fmtDate(r.last_movement_date) },
  ], VMD_COLUMN_TYPES, cf);

  const vendorCols = [
    { key: 'n', header: 'Vendor', render: (x) => <Button variant="quiet" onClick={() => patch({ vendor_id: String(x.vendor_id) })}>{x.vendor_name || `#${x.vendor_id}`}</Button> },
    { key: 'pq', header: 'Purchased', numeric: true, render: (x) => x.purchased_qty },
    { key: 'pv', header: 'Purchase value', numeric: true, render: (x) => fmtMoney(x.purchase_value) },
    { key: 'sq', header: 'Sold', numeric: true, render: (x) => x.sold_qty },
    { key: 'sv', header: 'Sale value', numeric: true, render: (x) => fmtMoney(x.sale_value) },
    { key: 'rq', header: 'Rental', numeric: true, render: (x) => x.rental_qty },
    { key: 'mr', header: 'Monthly rent', numeric: true, render: (x) => fmtMoney(x.monthly_rental_value) },
    { key: 'wq', header: 'Warehouse', numeric: true, render: (x) => x.warehouse_qty },
    { key: 'ret', header: 'Returned', numeric: true, render: (x) => x.returned_qty ?? 0 },
    { key: 'rep', header: 'Repair', numeric: true, render: (x) => x.repair_qty },
    { key: 'ct', header: 'Current total', numeric: true, render: (x) => x.current_total },
  ];
  const vendorRows = vendors.length ? [...vendors, {
    vendor_id: '__total', vendor_name: `Total (${vendors.length})`, ...totals, isTotal: true,
  }] : [];
  const vendorColsWithTotal = vendorCols.map((c) => (c.key === 'n'
    ? { ...c, render: (x) => (x.isTotal ? <strong>{x.vendor_name}</strong> : c.render(x)) }
    : { ...c, render: (x) => (['pv', 'sv', 'mr'].includes(c.key) && x.isTotal ? <strong>{c.render(x)}</strong> : c.render(x)) }));

  const vendorOptions = overview?.vendor_options || [];
  const customerOptions = overview?.customer_options || [];

  return (
    <div className="c-stack">
      <Section title="Filters" actions={<><Button variant="quiet" onClick={clearAll}>Clear all</Button><Button onClick={exportExcel} disabled={exporting || listLoading}>{exporting ? 'Exporting…' : 'Export Excel'}</Button></>}>
        <div className="c-stack" style={{ gap: '10px' }}>
          <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
            <Input type="search" placeholder="TTSPL, serial, vendor, customer, PO" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ maxWidth: '22rem' }} />
            <MultiSelect label="Vendor" options={vendorOptions} value={csv('vendor_id')} onChange={(x) => patch({ vendor_id: x })} />
            <MultiSelect label="Status" options={STATUS_OPTIONS} value={statuses} onChange={(x) => patch({ status: x })} />
            <MultiSelect label="Location" options={LOCATION_OPTIONS} value={csv('location')} onChange={(x) => patch({ location: x })} />
            <MultiSelect label="Stage" options={STAGE_OPTIONS} value={csv('stage')} onChange={(x) => patch({ stage: x })} />
            <MultiSelect label="Sale / rental" options={PRICING_OPTIONS} value={csv('pricing_type')} onChange={(x) => patch({ pricing_type: x })} />
            <MultiSelect label="Purchase type" options={purchaseTypeOptions} value={purchaseTypes} onChange={(x) => patch({ purchase_type: x, rental_lifecycle: '' })} />
            <MultiSelect label="Customer" options={customerOptions} value={csv('customer_id')} onChange={(x) => patch({ customer_id: x })} />
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: '12px' }}>
            <DateModeControl
              label="Purchase date"
              allValue="all"
              mode={pMode}
              months={pMonths}
              from={pFrom}
              to={pTo}
              onChange={({ mode, months: m, from, to }) => {
                const legacy = { date_mode: '', month: '', date_from: '', date_to: '' };
                if (mode === 'month') patch({ ...legacy, purchase_date_mode: 'month', purchase_month: m || (pMonths.length ? pMonths : currentMonthValue()), purchase_date_from: '', purchase_date_to: '' });
                else if (mode === 'range') patch({ ...legacy, purchase_date_mode: 'range', purchase_month: '', purchase_date_from: from ?? pFrom, purchase_date_to: to ?? pTo });
                else patch({ ...legacy, purchase_date_mode: 'all', purchase_month: '', purchase_date_from: '', purchase_date_to: '' });
              }}
            />
            <DateModeControl
              label="Sale & rental date"
              allValue="all"
              mode={aMode}
              months={aMonths}
              from={aFrom}
              to={aTo}
              onChange={({ mode, months: m, from, to }) => {
                if (mode === 'month') patch({ activity_date_mode: 'month', activity_month: m || (aMonths.length ? aMonths : currentMonthValue()), activity_date_from: '', activity_date_to: '' });
                else if (mode === 'range') patch({ activity_date_mode: 'range', activity_month: '', activity_date_from: from ?? aFrom, activity_date_to: to ?? aTo });
                else patch({ activity_date_mode: 'all', activity_month: '', activity_date_from: '', activity_date_to: '' });
              }}
            />
          </div>
          <SpecFilters sp={sp} patch={patch} />
          <p className="text-ink-3">
            Purchase date picks the laptops (unique serials bought in that window). Sale &amp; rental date narrows when those laptops were sold or rented.
            Warehouse and returned counts are where they are today. Vendors left out of Vendor PO are not counted.
          </p>
          {cf.count > 0 && <Button variant="quiet" onClick={cf.clearAll}>Clear {cf.count} column filter(s)</Button>}
        </div>
      </Section>

      {ovError && <Notice tone="crit" title="Could not load the overview">{ovError}</Notice>}
      <TileGrid>
        <ClickTile label="Total purchased" value={v(k.total_purchased)} hint="Unique purchases in the period" onClick={() => patch({ usage_bucket: '', warehouse_bucket: '', intake_type: '', status: '', rental_lifecycle: '' })} active={allActive} />
        <ClickTile label="Purchase value" value={money(k.total_purchase_value)} hint="Vendor PO rate" />
        <ClickTile label="Sold" value={v(k.sold_count)} family="closed" hint="Sold in the sale & rental window" onClick={() => toggleUsage('sold')} active={usage.length === 1 && usage[0] === 'sold'} />
        <ClickTile label="Sale value" value={money(k.total_sale_value)} hint="Customer sale price" />
        <ClickTile label="Rented" value={v(k.rental_count)} family="earning" hint="Rented in the sale & rental window" onClick={() => toggleUsage('rental')} active={usage.length === 1 && usage[0] === 'rental'} />
        <ClickTile label="Monthly rent" value={money(k.total_monthly_rental_value)} hint="Active monthly rent" />
        <ClickTile label="Warehouse" value={v(k.warehouse_count)} family="idle" hint="Not with a customer or vendor" onClick={() => toggleUsage('warehouse')} active={usage.length === 1 && usage[0] === 'warehouse'} />
        <ClickTile label="Out for repair" value={v(k.out_for_repair_count)} family="offcycle" hint="Vendor repair / in repair" onClick={() => toggleUsage('repair')} active={usage.length === 1 && usage[0] === 'repair'} />
        <ClickTile label="Vendor replacements" value={v(k.replacement_count)} hint={`${k.replacement_linked_count ?? 0} purchased units have a replacement`} onClick={() => patch({ intake_type: intakeType === 'replacement' ? '' : 'replacement', usage_bucket: '', warehouse_bucket: '', status: '', rental_lifecycle: '' })} active={intakeType === 'replacement'} />
        <ClickTile label="Returned" value={v(k.returned_count)} family="offcycle" hint="Currently returned" onClick={() => patch({ status: returnedActive ? '' : 'returned', intake_type: '', usage_bucket: '', warehouse_bucket: '', rental_lifecycle: '' })} active={returnedActive} />
      </TileGrid>

      <Section title="Rental purchase breakup">
        <TileGrid>
          <ClickTile label="Total rental purchase" value={v(k.rental_purchase_total)} onClick={() => patch({ purchase_type: 'rental_purchase', rental_lifecycle: '' })} active={purchaseTypes.length === 1 && purchaseTypes[0] === 'rental_purchase' && !rentalLifecycle} />
          <ClickTile label="Rented" value={v(k.rental_purchase_rented)} family="earning" hint="On rent / demo now" onClick={() => lifecycle('rented')} active={rentalLifecycle === 'rented'} />
          <ClickTile label="In warehouse" value={v(k.rental_purchase_warehouse)} family="idle" hint="Not rented, not returned" onClick={() => lifecycle('warehouse')} active={rentalLifecycle === 'warehouse'} />
          <ClickTile label="Returned" value={v(k.rental_purchase_returned)} family="offcycle" onClick={() => lifecycle('returned')} active={rentalLifecycle === 'returned'} />
        </TileGrid>
      </Section>

      <Section title="Warehouse production">
        <TileGrid min="9rem">
          {WAREHOUSE_STAGE_CARDS.map((c) => <ClickTile key={c.key} label={c.label} value={v(stages[c.key])} onClick={() => toggleBucket(c.key)} active={buckets.length === 1 && buckets[0] === c.key} />)}
        </TileGrid>
      </Section>

      <Section title="Vendor summary">
        {ovLoading && !overview ? <EmptyState title="Loading…" /> : (
          <DataTable columns={vendorColsWithTotal} rows={vendorRows} rowKey={(x) => x.vendor_id} empty={<EmptyState title="No vendors in this purchase period" />} />
        )}
      </Section>

      <Section title="Laptops">
        <div className="c-stack">
          <p className="text-ink-3">
            {(k.total_purchased ?? list?.pagination?.unique_total ?? 0)} unique purchases
            {(list?.pagination?.total || 0) > (k.total_purchased ?? list?.pagination?.unique_total ?? 0) ? ` · ${list.pagination.total} intake records (vendor repair replacements not counted)` : ''}
          </p>
          {listError && <Notice tone="crit" title="Could not load laptops">{listError}</Notice>}
          {listLoading && !list ? <EmptyState title="Loading…" /> : (
            <DataTable columns={laptopCols} rows={list?.data || []} rowKey={(r) => r.serial_id} empty={<EmptyState title="No laptops match" body="Filters combine — clear one to widen the list." />} />
          )}
          <Pager page={page} totalPages={list?.pagination?.totalPages} total={list?.pagination?.total} onPage={(p) => patch({ page: p }, { resetPage: false })} />
        </div>
      </Section>

      <ColumnFilterDrawer
        column={cf.openCol}
        type={cf.openCol ? VMD_COLUMN_TYPES[cf.openCol.key] : null}
        current={cf.openCol ? cf.filters[cf.openCol.key] : null}
        fetchValues={fetchValues}
        onApply={(f) => { cf.apply(cf.openCol.key, f); cf.setOpenCol(null); }}
        onClose={() => cf.setOpenCol(null)}
      />
    </div>
  );
}
