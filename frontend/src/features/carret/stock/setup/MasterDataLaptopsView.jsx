import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, DataTable, DocNumber, EmptyState, Input, Notice, Section, StatusChip, Tabs,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  exportMasterDataExcel, fetchMasterDataColumnValues, fetchMasterDataDashboard, fetchMasterDataKpis,
  setVendorExcludeFromVendorPo,
} from '../../../inventory-management/inventoryManagementApi';
import {
  clearColumnFilterParams, columnFiltersToParams, MD_COLUMN_TYPES, readColumnFiltersFromParams,
} from '../../../inventory-management/masterDataColumnFilters';
import { SPEC_FILTER_KEYS } from '../../../inventory-management/inventorySpecFilters';
import {
  ClickTile, ColumnFilterDrawer, currentMonthValue, DateModeControl, errMsg, fmtMoney, formatMonthLabel, humanize,
  MultiSelect, PAGE_SIZE, Pager, readCsv, SpecFilters, TileGrid, useColumnFilters, useLoader, useSearchBox,
  useSpecParams, useUrlFilters, withColumnFilters,
} from './MasterDataShared';

/**
 * Master data → Laptops (old /inventory-management/master-data,
 * section inventory_master_data). Every laptop from purchase to customer:
 * KPI drill-downs, Laptop master / Customers / Vendors / Floor sub-tabs,
 * Sheets-style column filters, Excel export, and the vendor
 * "exclude from Vendor PO" switch (inventory_master_data edit).
 */
const URL_KEYS = [
  'view', 'tab', 'page', 'q', 'status', 'location', 'stage', 'entity', 'pricing_type',
  'date_mode', 'month', 'date_from', 'date_to',
  'customer_id', 'vendor_id', 'from_vendor', 'ready', 'qc_process',
  ...SPEC_FILTER_KEYS,
];

const STATUS_OPTIONS = [
  'in_stock', 'reserved', 'in_transit', 'rented', 'on_demo', 'sold',
  'returned', 'in_repair', 'qc_failed', 'scrapped', 'dispatch_ready', 'returned_to_vendor',
].map((s) => ({ value: s, label: humanize(s) }));
const LOCATION_OPTIONS = ['Inventory', 'Customer', 'Floor', 'Vendor'];
const ENTITY_OPTIONS = [{ value: 'rentfoxxy', label: 'Rentfoxxy' }, { value: 'gorefurbo', label: 'Gorefurbo' }];
const PRICING_OPTIONS = [{ value: 'sale', label: 'Sale' }, { value: 'rental', label: 'Rental' }];
const DEFAULT_STAGES = ['Floor Manager', 'Pending Inventory', 'Inventory'];
const SUB_TABS = [
  { key: 'laptops', label: 'Laptop master' },
  { key: 'customers', label: 'Customers' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'floor', label: 'Floor' },
];
const CF = { read: readColumnFiltersFromParams, toParams: columnFiltersToParams, clear: clearColumnFilterParams };
// Drill-downs reset these before applying their own.
const DRILL_RESET = { customer_id: '', vendor_id: '', from_vendor: false, ready: false, qc_process: false, tab: 'laptops' };
const WIDE = { status: '', stage: '', location: '' };
const CUST = { pricing_type: '', stage: '', location: 'Customer' };

const sameSet = (a, b) => a.length === b.length && b.every((x) => a.includes(x));

function vendorPrice(r) {
  if (r.vendor_purchase_price == null) return '—';
  if (r.vendor_price_type === 'monthly') return `${fmtMoney(r.vendor_purchase_price)} rent/mo`;
  if (r.vendor_price_type === 'purchase') return `${fmtMoney(r.vendor_purchase_price)} purchase`;
  return fmtMoney(r.vendor_purchase_price);
}
function customerPrice(r) {
  if (r.customer_price == null) return '—';
  return `${fmtMoney(r.customer_price)} ${r.customer_price_type === 'sale' ? 'sale' : 'rent/mo'}`;
}
function specLine(r) {
  const screen = r.screen_size ? (/inch/i.test(r.screen_size) ? r.screen_size : `${r.screen_size}-inch`) : null;
  return [r.processor, r.generation, r.ram, r.storage, r.graphics, screen].filter(Boolean).join(' · ');
}
const stop = (e) => e.stopPropagation();

function summarizeVendors(rows) {
  return rows.reduce((acc, v) => {
    const n = Number(v.purchased_laptops || 0);
    const val = Number(v.purchase_value || 0);
    if (v.exclude_from_vendor_po) {
      acc.total_excluded_vendors += 1; acc.total_excluded_laptops += n; acc.total_excluded_purchase_value += val;
    } else {
      acc.total_vendors += 1; acc.total_purchased_laptops += n; acc.total_purchase_value += val;
    }
    return acc;
  }, {
    total_vendors: 0, total_purchased_laptops: 0, total_purchase_value: 0,
    total_excluded_vendors: 0, total_excluded_laptops: 0, total_excluded_purchase_value: 0,
  });
}

export default function MasterDataLaptopsView() {
  const { hasPermission } = usePermission();
  const canExclude = hasPermission('inventory_master_data', 'edit');
  const { sp, setSp, patch } = useUrlFilters(URL_KEYS);
  const [searchInput, setSearchInput] = useSearchBox(sp, patch);
  const cf = useColumnFilters(sp, setSp, CF);
  const specParams = useSpecParams(sp);
  const [exporting, setExporting] = useState(false);
  const [vendorOverride, setVendorOverride] = useState(null);
  const [busyVendor, setBusyVendor] = useState(null);

  const tab = sp.get('tab') || 'laptops';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const statuses = readCsv(sp, 'status');
  const locations = readCsv(sp, 'location');
  const stages = readCsv(sp, 'stage');
  const entities = readCsv(sp, 'entity');
  const pricing = readCsv(sp, 'pricing_type');
  const months = readCsv(sp, 'month');
  const dateFrom = sp.get('date_from') || '';
  const dateTo = sp.get('date_to') || '';
  const dateMode = sp.get('date_mode') || (dateFrom || dateTo ? 'range' : '');
  const customerId = sp.get('customer_id') || '';
  const vendorId = sp.get('vendor_id') || '';
  const fromVendor = sp.get('from_vendor') === '1';
  const ready = sp.get('ready') === '1';
  const qcProcess = sp.get('qc_process') === '1';
  const search = sp.get('q') || '';

  const common = useMemo(() => ({
    search: search || undefined,
    status: statuses.join(',') || undefined,
    location: locations.join(',') || undefined,
    stage: stages.join(',') || undefined,
    entity: entities.join(',') || undefined,
    pricing_type: pricing.join(',') || undefined,
    date_mode: dateMode || undefined,
    month: dateMode === 'month' ? (months.join(',') || currentMonthValue()) : undefined,
    date_from: dateMode === 'range' ? (dateFrom || undefined) : undefined,
    date_to: dateMode === 'range' ? (dateTo || undefined) : undefined,
    ...specParams,
  }), [search, statuses.join(','), locations.join(','), stages.join(','), entities.join(','), pricing.join(','), dateMode, months.join(','), dateFrom, dateTo, specParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabParams = useMemo(() => ({
    ...common,
    tab,
    page,
    limit: PAGE_SIZE,
    customer_id: customerId || undefined,
    vendor_id: vendorId || undefined,
    from_vendor: fromVendor ? '1' : undefined,
    ready: ready ? '1' : undefined,
    qc_process: qcProcess ? '1' : undefined,
  }), [common, tab, page, customerId, vendorId, fromVendor, ready, qcProcess]);
  const listParams = useMemo(() => (tab === 'laptops' ? { ...tabParams, ...cf.params } : tabParams), [tab, tabParams, cf.params]);

  const [kpis, kpiLoading, reloadKpis] = useLoader(
    () => fetchMasterDataKpis(common).then(({ data }) => data.kpis || {}),
    [common],
  );
  const [payload, loading, , loadError] = useLoader(
    () => fetchMasterDataDashboard(listParams).then(({ data }) => { setVendorOverride(null); return data; }),
    [listParams],
  );
  const [stageNames] = useLoader(
    () => fetchMasterDataDashboard({ tab: 'floor' }).then(({ data }) => (data.stages || []).map((s) => s.stage_name).filter(Boolean)),
    [],
  );
  const stageOptions = useMemo(() => [...new Set([...DEFAULT_STAGES, ...(stageNames || [])])], [stageNames]);

  const fetchValues = useCallback(
    (column) => fetchMasterDataColumnValues({ ...listParams, column }).then(({ data }) => data?.values || []),
    [listParams],
  );

  const k = kpis || {};
  const v = (x) => (kpiLoading && !kpis ? '…' : (x ?? 0));
  const drill = (changes) => patch({ ...DRILL_RESET, ...changes });
  const customerOnly = (list) => tab === 'laptops' && locations.length === 1 && locations[0] === 'Customer'
    && sameSet(statuses, list) && !fromVendor && !ready && !qcProcess && !pricing.length;

  const openStage = (name) => {
    if (name === 'Inventory') drill({ location: 'Inventory', stage: '', status: 'in_stock' });
    else if (name === 'Pending Inventory') drill({ stage: '', location: 'Floor' });
    else drill({ stage: name, location: 'Floor', status: '' });
  };

  const clearAll = () => {
    setSearchInput('');
    setSp((prev) => {
      const next = new URLSearchParams();
      next.set('view', prev.get('view') || 'laptops');
      if (prev.get('tab') && prev.get('tab') !== 'laptops') next.set('tab', prev.get('tab'));
      return next;
    }, { replace: true });
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const params = { ...listParams };
      delete params.page;
      delete params.limit;
      await exportMasterDataExcel(params);
      toast.success('Export downloaded');
    } catch (e) { toast.error(errMsg(e, 'Export failed')); } finally { setExporting(false); }
  };

  const vendors = vendorOverride || payload?.vendors || [];
  const vendorTotals = vendorOverride ? summarizeVendors(vendorOverride) : (payload?.totals || {});
  const toggleExclude = async (row, exclude) => {
    const prev = vendors;
    setVendorOverride(vendors.map((x) => (x.vendor_id === row.vendor_id ? { ...x, exclude_from_vendor_po: exclude } : x)));
    setBusyVendor(row.vendor_id);
    try {
      const { data } = await setVendorExcludeFromVendorPo(row.vendor_id, exclude);
      const saved = data.vendor?.exclude_from_vendor_po === true;
      setVendorOverride((cur) => (cur || prev).map((x) => (x.vendor_id === row.vendor_id ? { ...x, exclude_from_vendor_po: saved } : x)));
      toast.success(saved ? 'Vendor left out of Vendor PO lists and totals' : 'Vendor counted in Vendor PO lists and totals again');
      reloadKpis();
    } catch (e) {
      setVendorOverride(prev);
      toast.error(errMsg(e, 'Could not change the vendor'));
    } finally { setBusyVendor(null); }
  };

  const laptopCols = withColumnFilters([
    {
      key: 'ttspl_id',
      header: 'TTSPL',
      render: (r) => (r.ttspl_id ? <Link to={`/carret/stock/assets/${encodeURIComponent(r.ttspl_id)}`} onClick={stop}><DocNumber value={r.ttspl_id} /></Link> : '—'),
      sub: (r) => r.serial_number,
    },
    { key: 'serial_number', header: 'Serial', render: (r) => r.serial_number || '—' },
    { key: 'specs', header: 'Laptop', render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—', sub: (r) => specLine(r) || null },
    { key: 'current_status', header: 'Status', render: (r) => (r.current_status ? <StatusChip status={r.current_status} /> : '—') },
    { key: 'current_location', header: 'Location', render: (r) => r.current_location || '—' },
    {
      key: 'customer_name',
      header: 'Customer now',
      render: (r) => (r.customer_id ? <Link to={`/carret/sell/customers/${r.customer_id}`} onClick={stop}>{r.customer_name || `#${r.customer_id}`}</Link> : '—'),
    },
    { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || '—' },
    { key: 'vendor_type', header: 'Vendor type', render: (r) => r.purchase_order_type_label || '—' },
    { key: 'vendor_price', header: 'Vendor price', align: 'right', render: (r) => vendorPrice(r) },
    { key: 'customer_price', header: 'Customer price (ex. GST)', align: 'right', render: (r) => customerPrice(r) },
    { key: 'current_stage', header: 'Stage', render: (r) => r.current_stage || '—' },
    {
      key: 'sales_order_number',
      header: 'SO',
      render: (r) => (r.sales_order_number ? <Link to={`/carret/sell/sales-orders/${encodeURIComponent(r.sales_order_number)}`} onClick={stop}><DocNumber value={r.sales_order_number} /></Link> : '—'),
    },
    {
      key: 'delivery_challan_number',
      header: 'DC',
      render: (r) => (r.delivery_challan_number ? <Link to={`/carret/move/challans/${encodeURIComponent(r.delivery_challan_number)}`} onClick={stop}><DocNumber value={r.delivery_challan_number} /></Link> : '—'),
    },
    {
      key: 'purchase_order_number',
      header: 'PO',
      render: (r) => (r.po_id && r.purchase_order_number ? <Link to={`/carret/procure/purchase-orders/${r.po_id}`} onClick={stop}><DocNumber value={r.purchase_order_number} /></Link> : (r.purchase_order_number || '—')),
    },
    { key: 'grn_number', header: 'GRN', render: (r) => (r.grn_number ? <DocNumber value={r.grn_number} /> : '—') },
  ], MD_COLUMN_TYPES, cf);

  const customerCols = [
    { key: 'n', header: 'Customer', render: (c) => <Button variant="quiet" onClick={() => drill({ customer_id: String(c.customer_id), location: 'Customer' })}>{c.customer_name || `#${c.customer_id}`}</Button> },
    { key: 'a', header: 'Active', numeric: true, render: (c) => c.active_laptops },
    { key: 'r', header: 'Returned', numeric: true, render: (c) => c.returned_laptops },
    { key: 'm', header: 'Monthly rent (ex. GST)', numeric: true, render: (c) => fmtMoney(c.monthly_rental_value) },
    { key: 's', header: 'Sale value (ex. GST)', numeric: true, render: (c) => fmtMoney(c.sale_value) },
  ];
  const vendorCols = [
    {
      key: 'n',
      header: 'Vendor',
      render: (x) => <Button variant="quiet" onClick={() => drill({ vendor_id: String(x.vendor_id), location: '' })}>{x.vendor_name || `#${x.vendor_id}`}</Button>,
      sub: (x) => (x.exclude_from_vendor_po ? 'Left out of Vendor PO' : null),
    },
    { key: 'l', header: 'Laptops', numeric: true, render: (x) => x.purchased_laptops },
    { key: 'p', header: 'Purchase value', numeric: true, render: (x) => fmtMoney(x.purchase_value) },
    {
      key: 'x',
      header: 'Leave out of Vendor PO',
      render: (x) => (canExclude
        ? <Checkbox label={x.exclude_from_vendor_po ? 'Left out' : 'Leave out'} checked={Boolean(x.exclude_from_vendor_po)} disabled={busyVendor === x.vendor_id} onChange={(e) => toggleExclude(x, e.target.checked)} />
        : (x.exclude_from_vendor_po ? 'Left out' : 'Counted')),
    },
  ];

  const banner = tab === 'laptops' && (locations.length || fromVendor || ready || qcProcess || pricing.length || dateMode)
    ? (dateMode === 'month'
      ? `Laptops for ${(months.length ? months : [currentMonthValue()]).map(formatMonthLabel).join(', ')} (delivery / rent start / GRN date, IST)`
      : dateMode === 'range' && (dateFrom || dateTo) ? `Laptops ${dateFrom || '…'} to ${dateTo || '…'} (IST activity dates)`
        : pricing.length === 1 ? `${pricing[0] === 'sale' ? 'Sale' : 'Rental'} laptops only`
          : qcProcess ? 'QC process laptops (not ready to rent or sell)'
            : ready ? 'Ready to rent or sell'
              : locations.includes('Customer') ? 'Laptops with customers' : fromVendor ? 'Laptops sourced from vendors' : null)
    : null;

  return (
    <div className="c-stack">
      <TileGrid>
        <ClickTile label="Total laptops" value={v(k.total_laptops)} hint="Every laptop on a purchase order" onClick={() => drill({ ...WIDE, pricing_type: '' })} active={tab === 'laptops' && !locations.length && !fromVendor && !ready && !qcProcess && !customerId && !vendorId && !pricing.length} />
        <ClickTile label="From vendors" value={v(k.total_from_vendors)} hint="Counted vendor POs (left-out vendors hidden)" onClick={() => drill({ ...WIDE, from_vendor: true })} active={fromVendor && tab === 'laptops'} />
        <ClickTile label="Customers" value={v(k.total_customers)} hint="In current filters" />
        <ClickTile label="Vendors" value={v(k.total_vendors)} hint="In current filters" />
        <ClickTile label="QC process" value={v(k.total_qc_process)} family="offcycle" hint="Not ready — floor / QC / repair" onClick={() => drill({ ...WIDE, qc_process: true })} active={qcProcess && tab === 'laptops'} />
        <ClickTile label="Ready to rent / sell" value={v(k.total_ready_to_rent_sale)} family="idle" hint="In stock and QC passed" onClick={() => drill({ ...WIDE, ready: true })} active={ready && tab === 'laptops'} />
      </TileGrid>
      <TileGrid>
        <ClickTile label="Rental" value={v(k.customer_rental_units)} family="earning" hint="With customer — rented" onClick={() => drill({ ...CUST, status: 'rented' })} active={customerOnly(['rented'])} />
        <ClickTile label="Sold" value={v(k.customer_sold_units)} family="closed" hint="Sale delivered / dispatched" onClick={() => drill({ ...CUST, status: 'sold' })} active={customerOnly(['sold'])} />
        <ClickTile label="In transit" value={v(k.customer_in_transit_units)} family="moving" hint="Allocated, not delivered" onClick={() => drill({ ...CUST, status: 'in_transit,reserved,dispatch_ready' })} active={customerOnly(['in_transit', 'reserved', 'dispatch_ready'])} />
        <ClickTile label="Demo" value={v(k.customer_demo_units)} family="earning" hint="With customer — on demo" onClick={() => drill({ ...CUST, status: 'on_demo' })} active={customerOnly(['on_demo'])} />
        <ClickTile label="Sale value (ex. GST)" value={kpiLoading && !kpis ? '…' : fmtMoney(k.total_sale_value)} hint="Sold units at SO rate" onClick={() => drill({ ...CUST, status: 'sold' })} active={customerOnly(['sold'])} />
        <ClickTile label="Monthly rent (ex. GST)" value={kpiLoading && !kpis ? '…' : fmtMoney(k.total_monthly_rental_value)} hint="Rented units at SO rate" onClick={() => drill({ ...CUST, status: 'rented' })} active={customerOnly(['rented'])} />
      </TileGrid>

      <Section title="Filters" actions={<Button variant="quiet" onClick={clearAll}>Clear all</Button>}>
        <div className="c-stack" style={{ gap: '10px' }}>
          <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
            <Input type="search" placeholder="TTSPL, serial, customer, vendor, SO, DC, PO" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ maxWidth: '22rem' }} />
            <MultiSelect label="Status" options={STATUS_OPTIONS} value={statuses} onChange={(x) => patch({ status: x })} />
            <MultiSelect label="Location" options={LOCATION_OPTIONS} value={locations} onChange={(x) => patch({ location: x })} />
            <MultiSelect label="Stage" options={stageOptions} value={stages} onChange={(x) => patch({ stage: x })} />
            <MultiSelect label="Type" options={PRICING_OPTIONS} value={pricing} onChange={(x) => patch({ pricing_type: x })} />
            <MultiSelect label="Entity" options={ENTITY_OPTIONS} value={entities} onChange={(x) => patch({ entity: x })} />
            <DateModeControl
              label="Date"
              mode={dateMode}
              months={months}
              from={dateFrom}
              to={dateTo}
              onChange={({ mode, months: m, from, to }) => {
                if (mode === 'month') patch({ date_mode: 'month', month: m || (months.length ? months : currentMonthValue()), date_from: '', date_to: '' });
                else if (mode === 'range') patch({ date_mode: 'range', month: '', date_from: from ?? dateFrom, date_to: to ?? dateTo });
                else patch({ date_mode: '', month: '', date_from: '', date_to: '' });
              }}
            />
          </div>
          <SpecFilters sp={sp} patch={patch} />
          {(customerId || vendorId || cf.count > 0) && (
            <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
              {customerId && <span className="text-ink-3">Customer #{customerId}</span>}
              {vendorId && <span className="text-ink-3">Vendor #{vendorId}</span>}
              {cf.count > 0 && <Button variant="quiet" onClick={cf.clearAll}>Clear {cf.count} column filter(s)</Button>}
            </div>
          )}
        </div>
      </Section>

      {banner && <Notice tone="info" action={<Button variant="quiet" onClick={clearAll}>Clear</Button>}>{banner}</Notice>}

      <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
        <Tabs tabs={SUB_TABS} value={tab} onChange={(t) => patch({ tab: t })} />
        <Button onClick={exportExcel} disabled={exporting || loading} style={{ marginLeft: 'auto' }}>{exporting ? 'Exporting…' : 'Export Excel'}</Button>
      </div>

      {loadError && <Notice tone="crit" title="Could not load master data">{loadError}</Notice>}
      {loading && (!payload || payload.tab !== tab) ? <EmptyState title="Loading…" /> : payload && payload.tab === tab && (
        <>
          {tab === 'laptops' && (
            <>
              <p className="text-ink-3">SO, DC and customer price show only while the laptop is with a customer now. Use the filter icon on a column to pick values, like a spreadsheet.</p>
              <DataTable columns={laptopCols} rows={payload.data || []} rowKey={(r) => r.serial_id} empty={<EmptyState title="No laptops match" body="Filters combine — clear one to widen the list." />} />
              <Pager page={page} totalPages={payload.pagination?.totalPages} total={payload.pagination?.total} onPage={(p) => patch({ page: p }, { resetPage: false })} />
            </>
          )}
          {tab === 'customers' && (
            <>
              <TileGrid>
                <ClickTile label="Customers" value={payload.totals?.total_customers ?? 0} />
                <ClickTile label="Active laptops" value={payload.totals?.total_active_laptops ?? 0} />
                <ClickTile label="Returned" value={payload.totals?.total_returned_laptops ?? 0} />
                <ClickTile label="Monthly rent (ex. GST)" value={fmtMoney(payload.totals?.total_monthly_rental_value)} />
                <ClickTile label="Sale value (ex. GST)" value={fmtMoney(payload.totals?.total_sale_value)} />
              </TileGrid>
              <DataTable columns={customerCols} rows={payload.customers || []} rowKey={(c) => c.customer_id} empty={<EmptyState title="No customer assets" />} />
            </>
          )}
          {tab === 'vendors' && (
            <>
              <TileGrid>
                <ClickTile label="Vendors (Vendor PO)" value={vendorTotals.total_vendors ?? 0} />
                <ClickTile label="Purchased laptops" value={vendorTotals.total_purchased_laptops ?? 0} />
                <ClickTile label="Purchase value" value={fmtMoney(vendorTotals.total_purchase_value)} />
              </TileGrid>
              {(vendorTotals.total_excluded_vendors || 0) > 0 && (
                <p className="text-ink-3">
                  {vendorTotals.total_excluded_vendors} vendor(s) left out of Vendor PO ({vendorTotals.total_excluded_laptops || 0} laptops, {fmtMoney(vendorTotals.total_excluded_purchase_value)} not counted). Their laptops stay in stock.
                </p>
              )}
              <DataTable columns={vendorCols} rows={vendors} rowKey={(x) => x.vendor_id} empty={<EmptyState title="No vendors" />} />
            </>
          )}
          {tab === 'floor' && (
            <TileGrid>
              {(payload.stages || []).map((s) => <ClickTile key={s.stage_name} label={s.stage_name} value={s.count} onClick={() => openStage(s.stage_name)} />)}
              {!(payload.stages || []).length && <EmptyState title="No floor stages" />}
            </TileGrid>
          )}
        </>
      )}

      <ColumnFilterDrawer
        column={cf.openCol}
        type={cf.openCol ? MD_COLUMN_TYPES[cf.openCol.key] : null}
        current={cf.openCol ? cf.filters[cf.openCol.key] : null}
        fetchValues={fetchValues}
        onApply={(f) => { cf.apply(cf.openCol.key, f); cf.setOpenCol(null); }}
        onClose={() => cf.setOpenCol(null)}
      />
    </div>
  );
}
