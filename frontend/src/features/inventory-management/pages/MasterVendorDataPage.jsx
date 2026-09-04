import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Building2, FileSpreadsheet, HardDrive, IndianRupee, Laptop, Loader2, Package, Wrench,
} from 'lucide-react';
import { PageHeader, StatCard, SearchField, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import InventorySpecFilterBar from '../components/InventorySpecFilterBar';
import { EMPTY_SPEC_FILTERS, SPEC_FILTER_KEYS, specFiltersToParams, parseSpecMultiUrl } from '../inventorySpecFilters';
import SearchableMultiSelect from '../../operation-management/components/SearchableMultiSelect';
import useDebouncedSpecParams from '../hooks/useDebouncedSpecParams';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  exportVendorMasterExcel,
  fetchVendorMasterColumnValues,
  fetchVendorMasterLaptops,
  fetchVendorMasterOverview,
} from '../inventoryManagementApi';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import TtsplHistoryLink from '../../floor-pipeline/components/TtsplHistoryLink';
import SheetsColumnFilter from '../../../components/ui/SheetsColumnFilter';
import {
  clearColumnFilterParams,
  columnFiltersToParams,
  readColumnFiltersFromParams,
  VMD_COLUMN_TYPES,
} from '../vendorMasterColumnFilters';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  'in_stock', 'reserved', 'in_transit', 'rented', 'on_demo', 'sold',
  'returned', 'in_repair', 'qc_failed', 'scrapped',
];

const LOCATION_OPTIONS = [
  { value: 'Customer', label: 'Customer' },
  { value: 'Inventory', label: 'Warehouse / Inventory' },
  { value: 'Floor', label: 'Floor / Production' },
  { value: 'Vendor', label: 'Vendor Repair' },
];

const STAGE_OPTIONS = [
  'QC1', 'QC2', 'Diagnosis', 'Chip Level Repair', 'Assembly & Software',
  'Final Testing', 'Dispatch QC', 'Floor Manager', 'Pending Inventory', 'Inventory',
];

const PRICING_TYPE_OPTIONS = [
  { value: 'sale', label: 'Sale' },
  { value: 'rental', label: 'Rental' },
];

const DATE_MODE_OPTIONS = [
  { value: '', label: 'All time' },
  { value: 'month', label: 'By month' },
  { value: 'range', label: 'Custom date range' },
];

const WAREHOUSE_STAGE_CARDS = [
  { key: 'qc1', label: 'QC1' },
  { key: 'qc2', label: 'QC2' },
  { key: 'diagnosis_hardware', label: 'Diagnosis - Hardware' },
  { key: 'diagnosis_software', label: 'Diagnosis - Software' },
  { key: 'final_testing', label: 'Final Testing' },
  { key: 'ready_to_rent', label: 'Ready to Rent' },
  { key: 'ready_to_sell', label: 'Ready to Sell' },
  { key: 'dead_scrapped', label: 'Dead / Scrapped' },
  { key: 'other', label: 'Other' },
];

const URL_KEYS = [
  'page', 'q', 'status', 'location', 'stage', 'pricing_type',
  'date_mode', 'month', 'date_from', 'date_to',
  'vendor_id', 'warehouse_bucket',
  ...SPEC_FILTER_KEYS,
];

function readCsvParam(sp, key) {
  return String(sp.get(key) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function currentMonthValue() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
}

function buildMonthOptions(count = 24) {
  const options = [];
  const anchor = new Date();
  anchor.setDate(1);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    const value = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
    const label = d.toLocaleDateString('en-IN', {
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    options.push({ value, label });
  }
  return options;
}

const MONTH_OPTIONS = buildMonthOptions();

const LAPTOP_TABLE_COLUMNS = [
  { key: 'ttspl_id', label: 'TTSPL', align: 'left' },
  { key: 'serial_number', label: 'Serial', align: 'left' },
  { key: 'vendor_name', label: 'Vendor', align: 'left' },
  { key: 'purchase_date', label: 'Purchase Date', align: 'left' },
  { key: 'purchase_order_number', label: 'PO', align: 'left' },
  { key: 'purchase_rate', label: 'Purchase Rate', align: 'right' },
  { key: 'brand', label: 'Brand / Model', align: 'left' },
  { key: 'specs', label: 'Specs', align: 'left' },
  { key: 'current_status', label: 'Status', align: 'left' },
  { key: 'location_label', label: 'Location', align: 'left' },
  { key: 'current_stage', label: 'Stage', align: 'left' },
  { key: 'customer_name', label: 'Customer', align: 'left' },
  { key: 'so_dc', label: 'SO / DC', align: 'left' },
  { key: 'sale_rent', label: 'Sale / Rent', align: 'right' },
  { key: 'last_movement_date', label: 'Last Movement', align: 'left' },
];

function readSpecFilters(sp) {
  const next = { ...EMPTY_SPEC_FILTERS };
  SPEC_FILTER_KEYS.forEach((k) => {
    next[k] = parseSpecMultiUrl(sp.get(k)).join(',');
  });
  return next;
}

const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
}

export default function MasterVendorDataPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [kpis, setKpis] = useState({});
  const [vendors, setVendors] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [historyTtspl, setHistoryTtspl] = useState(null);
  const [exporting, setExporting] = useState(false);
  const listAnchorRef = useRef(null);
  const overviewReqRef = useRef(0);
  const listReqRef = useRef(0);
  const lastOverviewKey = useRef('');
  const lastListKey = useRef('');

  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 350);

  const queryKey = searchParams.toString();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const search = searchParams.get('q') || '';
  const status = searchParams.get('status') || '';
  const location = searchParams.get('location') || '';
  const stage = searchParams.get('stage') || '';
  const pricingType = searchParams.get('pricing_type') || '';
  const vendorId = searchParams.get('vendor_id') || '';
  const warehouseBucket = searchParams.get('warehouse_bucket') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const dateMode = searchParams.get('date_mode') || (dateFrom || dateTo ? 'range' : 'month');
  const month = searchParams.get('month') || '';
  const statuses = useMemo(() => readCsvParam(searchParams, 'status'), [status]);
  const locations = useMemo(() => readCsvParam(searchParams, 'location'), [location]);
  const stagesSelected = useMemo(() => readCsvParam(searchParams, 'stage'), [stage]);
  const pricingTypes = useMemo(() => readCsvParam(searchParams, 'pricing_type'), [pricingType]);
  const vendorIds = useMemo(() => readCsvParam(searchParams, 'vendor_id'), [vendorId]);
  const warehouseBuckets = useMemo(() => readCsvParam(searchParams, 'warehouse_bucket'), [warehouseBucket]);
  const months = useMemo(() => readCsvParam(searchParams, 'month'), [month]);
  const specFilters = useMemo(() => readSpecFilters(searchParams), [queryKey]);
  const debouncedSpecs = useDebouncedSpecParams(specFilters);
  const columnFilters = useMemo(() => readColumnFiltersFromParams(searchParams), [queryKey]);
  const columnFilterParams = useMemo(() => columnFiltersToParams(columnFilters), [columnFilters]);

  const patchParams = useCallback((patch, { resetPage = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const apply = { ...patch };
      if (resetPage && !Object.prototype.hasOwnProperty.call(apply, 'page')) apply.page = 1;
      Object.entries(apply).forEach(([k, v]) => {
        if (k !== 'page' && !URL_KEYS.includes(k)) return;
        const normalized = Array.isArray(v) ? v.filter(Boolean).join(',') : v;
        if (normalized === '' || normalized == null || normalized === false || (k === 'page' && Number(normalized) <= 1)) next.delete(k);
        else if (normalized === true) next.set(k, '1');
        else next.set(k, String(normalized));
      });
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const current = searchParams.get('q') || '';
    if (debouncedSearch === current) return;
    patchParams({ q: debouncedSearch || '' });
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSearchInput((prev) => (prev.trim() === search ? prev : search));
  }, [search]);

  const filterParams = useMemo(() => ({
    search: search || undefined,
    status: status || undefined,
    location: location || undefined,
    stage: stage || undefined,
    pricing_type: pricingType || undefined,
    vendor_id: vendorId || undefined,
    warehouse_bucket: warehouseBucket || undefined,
    date_mode: dateMode || undefined,
    month: dateMode === 'month' ? (month || currentMonthValue()) : undefined,
    date_from: dateMode === 'range' ? (dateFrom || undefined) : undefined,
    date_to: dateMode === 'range' ? (dateTo || undefined) : undefined,
    ...specFiltersToParams(debouncedSpecs),
  }), [
    search, status, location, stage, pricingType, vendorId, warehouseBucket,
    dateMode, month, dateFrom, dateTo, debouncedSpecs,
  ]);

  const listFilterParams = useMemo(() => ({
    ...filterParams,
    ...columnFilterParams,
  }), [filterParams, columnFilterParams]);

  const loadOverview = useCallback(async () => {
    const reqId = ++overviewReqRef.current;
    setOverviewLoading(true);
    try {
      const { data } = await fetchVendorMasterOverview(filterParams);
      if (reqId !== overviewReqRef.current) return;
      if (!data?.success) throw new Error(data?.message || 'Failed');
      setKpis(data.kpis || {});
      setVendors(data.vendors || []);
      setVendorOptions(data.vendor_options || []);
    } catch (e) {
      if (reqId !== overviewReqRef.current) return;
      toast.error(e.response?.data?.message || e.message || 'Failed to load vendor master KPIs');
    } finally {
      if (reqId === overviewReqRef.current) setOverviewLoading(false);
    }
  }, [filterParams]);

  const loadList = useCallback(async () => {
    const reqId = ++listReqRef.current;
    setListLoading(true);
    try {
      const { data } = await fetchVendorMasterLaptops({ ...listFilterParams, page, limit: PAGE_SIZE });
      if (reqId !== listReqRef.current) return;
      if (!data?.success) throw new Error(data?.message || 'Failed');
      setRows(data.data || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (e) {
      if (reqId !== listReqRef.current) return;
      toast.error(e.response?.data?.message || e.message || 'Failed to load vendor laptops');
    } finally {
      if (reqId === listReqRef.current) setListLoading(false);
    }
  }, [listFilterParams, page]);

  useEffect(() => {
    const key = JSON.stringify(filterParams);
    if (lastOverviewKey.current === key) return;
    lastOverviewKey.current = key;
    loadOverview();
  }, [filterParams, loadOverview]);

  useEffect(() => {
    const key = JSON.stringify({ ...listFilterParams, page });
    if (lastListKey.current === key) return;
    lastListKey.current = key;
    loadList();
  }, [listFilterParams, page, loadList]);

  const clearFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams({ date_mode: 'month', month: currentMonthValue() }), { replace: true });
  };

  const fetchColumnOptions = useCallback(async (columnKey) => {
    const { data } = await fetchVendorMasterColumnValues({ ...listFilterParams, column: columnKey });
    return data?.values || [];
  }, [listFilterParams]);

  const applyColumnFilter = useCallback((columnKey, filter) => {
    setSearchParams((prev) => {
      const next = clearColumnFilterParams(prev);
      const merged = { ...readColumnFiltersFromParams(prev) };
      if (filter) merged[columnKey] = filter;
      else delete merged[columnKey];
      Object.entries(columnFiltersToParams(merged)).forEach(([k, v]) => next.set(k, v));
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const clearColumnFilter = useCallback((columnKey) => {
    applyColumnFilter(columnKey, null);
  }, [applyColumnFilter]);

  const setSpecFilters = (next) => {
    const value = typeof next === 'function' ? next(specFilters) : next;
    const patch = {};
    SPEC_FILTER_KEYS.forEach((k) => { patch[k] = value?.[k] || ''; });
    patchParams(patch);
  };

  const openVendor = (id) => {
    patchParams({ vendor_id: String(id) });
    listAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleBucket = (key) => {
    const next = warehouseBuckets.includes(key) ? [] : [key];
    patchParams({ warehouse_bucket: next });
    listAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportVendorMasterExcel(listFilterParams);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const stages = kpis.warehouse_stages || {};

  const vendorTotals = useMemo(() => vendors.reduce((acc, v) => ({
    purchased_qty: acc.purchased_qty + Number(v.purchased_qty || 0),
    purchase_value: acc.purchase_value + Number(v.purchase_value || 0),
    sold_qty: acc.sold_qty + Number(v.sold_qty || 0),
    sale_value: acc.sale_value + Number(v.sale_value || 0),
    rental_qty: acc.rental_qty + Number(v.rental_qty || 0),
    monthly_rental_value: acc.monthly_rental_value + Number(v.monthly_rental_value || 0),
    warehouse_qty: acc.warehouse_qty + Number(v.warehouse_qty || 0),
    repair_qty: acc.repair_qty + Number(v.repair_qty || 0),
    current_total: acc.current_total + Number(v.current_total || 0),
  }), {
    purchased_qty: 0,
    purchase_value: 0,
    sold_qty: 0,
    sale_value: 0,
    rental_qty: 0,
    monthly_rental_value: 0,
    warehouse_qty: 0,
    repair_qty: 0,
    current_total: 0,
  }), [vendors]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master Vendor Data"
        subtitle="Laptops purchased from vendors in the selected PO period, with current location and usage"
      />

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <SearchField
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search TTSPL, serial, vendor, customer, PO…"
            className="flex-1 min-w-[220px]"
          />
          <div className="min-w-[11rem] w-44">
            <SearchableMultiSelect
              id="vmd-vendor"
              value={vendorIds}
              onChange={(vals) => patchParams({ vendor_id: vals })}
              options={vendorOptions}
              placeholder="All vendors"
              countNoun="vendor"
              compact
              searchPlaceholder="Search vendor…"
            />
          </div>
          <div className="min-w-[11rem] w-44">
            <SearchableMultiSelect
              id="vmd-status"
              value={statuses}
              onChange={(vals) => patchParams({ status: vals })}
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))}
              placeholder="All statuses"
              countNoun="status"
              compact
              searchPlaceholder="Search status…"
            />
          </div>
          <div className="min-w-[11rem] w-44">
            <SearchableMultiSelect
              id="vmd-location"
              value={locations}
              onChange={(vals) => patchParams({ location: vals })}
              options={LOCATION_OPTIONS}
              placeholder="All locations"
              countNoun="location"
              compact
              searchPlaceholder="Search location…"
            />
          </div>
          <div className="min-w-[11rem] w-44">
            <SearchableMultiSelect
              id="vmd-stage"
              value={stagesSelected}
              onChange={(vals) => patchParams({ stage: vals })}
              options={STAGE_OPTIONS}
              placeholder="All stages"
              countNoun="stage"
              compact
              searchPlaceholder="Search stage…"
            />
          </div>
          <div className="min-w-[10rem] w-40">
            <SearchableMultiSelect
              id="vmd-pricing"
              value={pricingTypes}
              onChange={(vals) => patchParams({ pricing_type: vals })}
              options={PRICING_TYPE_OPTIONS}
              placeholder="Sale / Rental"
              countNoun="type"
              compact
              searchPlaceholder="Search type…"
            />
          </div>
          <select
            className="border rounded-lg px-3 py-2 text-sm min-w-[9.5rem] min-h-[38px]"
            value={dateMode}
            onChange={(e) => {
              const next = e.target.value;
              if (next === 'month') {
                patchParams({
                  date_mode: 'month',
                  month: months.join(',') || currentMonthValue(),
                  date_from: '',
                  date_to: '',
                });
              } else if (next === 'range') {
                patchParams({ date_mode: 'range', month: '' });
              } else {
                patchParams({ date_mode: '', month: '', date_from: '', date_to: '' });
              }
            }}
            aria-label="Purchase date mode"
          >
            {DATE_MODE_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {dateMode === 'month' ? (
            <div className="min-w-[11rem] w-44">
              <SearchableMultiSelect
                id="vmd-month"
                value={months.length ? months : [currentMonthValue()]}
                onChange={(vals) => patchParams({
                  date_mode: 'month',
                  month: vals.length ? vals : currentMonthValue(),
                  date_from: '',
                  date_to: '',
                })}
                options={MONTH_OPTIONS}
                placeholder="Select months"
                countNoun="month"
                compact
                searchPlaceholder="Search month…"
              />
            </div>
          ) : null}
          {dateMode === 'range' ? (
            <DateRangeFilter
              layout="inline"
              showPresets={false}
              fromLabel="From"
              toLabel="To"
              dateFrom={dateFrom}
              dateTo={dateTo}
              onRangeChange={({ dateFrom: from, dateTo: to }) => patchParams({
                date_mode: 'range',
                month: '',
                date_from: from,
                date_to: to,
              })}
              onDateFromChange={(v) => patchParams({ date_mode: 'range', month: '', date_from: v })}
              onDateToChange={(v) => patchParams({ date_mode: 'range', month: '', date_to: v })}
            />
          ) : null}
          <button type="button" onClick={clearFilters} className="text-sm px-3 py-2 border rounded-lg text-slate-600 hover:bg-slate-50">
            Clear
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || listLoading}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 border rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Export Excel
          </button>
        </div>
        <InventorySpecFilterBar
          filters={specFilters}
          onChange={setSpecFilters}
          onClear={() => setSpecFilters(EMPTY_SPEC_FILTERS)}
        />
        <p className="text-xs text-slate-500">
          Population is laptops on vendor POs in the selected <strong>purchase date</strong> (PO date).
          Cards then show where those same units are today. Excluded Vendor PO vendors are omitted.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Purchased" value={overviewLoading ? '…' : (kpis.total_purchased ?? 0)} icon={Laptop} hint="Vendor PO units in period" />
        <StatCard label="Purchase Value" value={overviewLoading ? '…' : fmtMoney(kpis.total_purchase_value)} icon={IndianRupee} hint="Vendor PO purchase rate" />
        <StatCard label="Sold Laptops" value={overviewLoading ? '…' : (kpis.sold_count ?? 0)} icon={HardDrive} tone="red" hint="Currently sold" />
        <StatCard label="Sale Value" value={overviewLoading ? '…' : fmtMoney(kpis.total_sale_value)} icon={IndianRupee} tone="red" hint="Customer sale price" />
        <StatCard label="Rented Laptops" value={overviewLoading ? '…' : (kpis.rental_count ?? 0)} icon={Package} tone="blue" hint="Currently on rent / demo" />
        <StatCard label="Monthly Rental Value" value={overviewLoading ? '…' : fmtMoney(kpis.total_monthly_rental_value)} icon={IndianRupee} tone="blue" hint="Active monthly rent" />
        <StatCard label="Warehouse" value={overviewLoading ? '…' : (kpis.warehouse_count ?? 0)} icon={Building2} tone="teal" hint="Not with customer / not on VRDC" />
        <StatCard
          label="Out for Repair"
          value={overviewLoading ? '…' : (kpis.out_for_repair_count ?? 0)}
          icon={Wrench}
          tone="amber"
          hint="Vendor repair / in repair"
          onClick={() => toggleBucket('out_for_repair')}
          active={warehouseBuckets.length === 1 && warehouseBuckets[0] === 'out_for_repair'}
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Warehouse production</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {WAREHOUSE_STAGE_CARDS.map((card) => (
            <StatCard
              key={card.key}
              label={card.label}
              value={overviewLoading ? '…' : (stages[card.key] ?? 0)}
              onClick={() => toggleBucket(card.key)}
              active={warehouseBuckets.length === 1 && warehouseBuckets[0] === card.key}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Vendor summary</h2>
        <div className="border rounded-xl overflow-x-auto bg-white">
          <table className="w-full text-sm min-w-[880px]">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-right">Purchased</th>
                <th className="px-3 py-2 text-right">Purchase Value</th>
                <th className="px-3 py-2 text-right">Sold</th>
                <th className="px-3 py-2 text-right">Sale Value</th>
                <th className="px-3 py-2 text-right">Rental</th>
                <th className="px-3 py-2 text-right">Monthly Rental</th>
                <th className="px-3 py-2 text-right">Warehouse</th>
                <th className="px-3 py-2 text-right">Repair</th>
                <th className="px-3 py-2 text-right">Current Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {vendors.map((v) => (
                <tr key={v.vendor_id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <button type="button" className="text-blue-700 hover:underline font-medium" onClick={() => openVendor(v.vendor_id)}>
                      {v.vendor_name || `#${v.vendor_id}`}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">{v.purchased_qty}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(v.purchase_value)}</td>
                  <td className="px-3 py-2 text-right">{v.sold_qty}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(v.sale_value)}</td>
                  <td className="px-3 py-2 text-right">{v.rental_qty}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(v.monthly_rental_value)}</td>
                  <td className="px-3 py-2 text-right">{v.warehouse_qty}</td>
                  <td className="px-3 py-2 text-right">{v.repair_qty}</td>
                  <td className="px-3 py-2 text-right font-medium">{v.current_total}</td>
                </tr>
              ))}
              {!overviewLoading && !vendors.length ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">No vendors in this purchase period</td></tr>
              ) : null}
            </tbody>
            {vendors.length ? (
              <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                <tr className="font-semibold text-slate-800">
                  <td className="px-3 py-2.5 text-left">Total ({vendors.length})</td>
                  <td className="px-3 py-2.5 text-right">{vendorTotals.purchased_qty}</td>
                  <td className="px-3 py-2.5 text-right">{fmtMoney(vendorTotals.purchase_value)}</td>
                  <td className="px-3 py-2.5 text-right">{vendorTotals.sold_qty}</td>
                  <td className="px-3 py-2.5 text-right">{fmtMoney(vendorTotals.sale_value)}</td>
                  <td className="px-3 py-2.5 text-right">{vendorTotals.rental_qty}</td>
                  <td className="px-3 py-2.5 text-right">{fmtMoney(vendorTotals.monthly_rental_value)}</td>
                  <td className="px-3 py-2.5 text-right">{vendorTotals.warehouse_qty}</td>
                  <td className="px-3 py-2.5 text-right">{vendorTotals.repair_qty}</td>
                  <td className="px-3 py-2.5 text-right">{vendorTotals.current_total}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <div ref={listAnchorRef} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Laptop inventory</h2>
          <p className="text-xs text-slate-500">{pagination.total || 0} laptops</p>
        </div>
        <div className="border rounded-xl overflow-x-auto bg-white">
          {listLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading
            </div>
          ) : (
            <table className="w-full text-sm min-w-[1400px]">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  {LAPTOP_TABLE_COLUMNS.map((col) => (
                    <SheetsColumnFilter
                      key={col.key}
                      columnKey={col.key}
                      label={col.label}
                      filterType={VMD_COLUMN_TYPES[col.key] || 'text'}
                      align={col.align}
                      activeFilter={columnFilters[col.key]}
                      onApplyFilter={applyColumnFilter}
                      onClearFilter={clearColumnFilter}
                      fetchOptions={fetchColumnOptions}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.serial_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">
                      <TtsplHistoryLink ttsplId={r.ttspl_id} onOpen={setHistoryTtspl} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.serial_number || '—'}</td>
                    <td className="px-3 py-2">{r.vendor_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.purchase_date)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.purchase_order_number || '—'}</td>
                    <td className="px-3 py-2 text-right">{r.purchase_rate != null ? fmtMoney(r.purchase_rate) : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.brand || '—'}</div>
                      <div className="text-xs text-slate-500">{r.model || ''}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {[r.processor, r.generation, r.ram, r.storage, r.graphics, r.screen_size].filter(Boolean).join(' | ') || '—'}
                    </td>
                    <td className="px-3 py-2 capitalize">{String(r.current_status || '').replace(/_/g, ' ') || '—'}</td>
                    <td className="px-3 py-2">{r.location_label || r.current_location || '—'}</td>
                    <td className="px-3 py-2">{r.current_stage || '—'}</td>
                    <td className="px-3 py-2">{r.customer_name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.sales_order_number || '—'}
                      {r.delivery_challan_number ? <div>{r.delivery_challan_number}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.sale_price != null ? `${fmtMoney(r.sale_price)} sale` : null}
                      {r.customer_monthly_rate != null ? `${fmtMoney(r.customer_monthly_rate)}/mo` : null}
                      {r.sale_price == null && r.customer_monthly_rate == null ? '—' : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.last_movement_date)}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr><td colSpan={15} className="px-3 py-8 text-center text-slate-400">No purchased laptops in this period</td></tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
        <ListPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          pageSize={pagination.limit || PAGE_SIZE}
          onPageChange={(nextPage) => patchParams({ page: nextPage }, { resetPage: false })}
        />
      </div>

      <TtsplHistoryDrawer
        ttsplId={historyTtspl}
        open={Boolean(historyTtspl)}
        onClose={() => setHistoryTtspl(null)}
      />
    </div>
  );
}
