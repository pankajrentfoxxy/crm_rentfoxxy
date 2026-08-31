import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Building2, FileSpreadsheet, IndianRupee, Laptop, Loader2, RefreshCw, UserRound, Wrench,
} from 'lucide-react';
import { PageHeader, StatCard, SearchField, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import InventorySpecFilterBar from '../components/InventorySpecFilterBar';
import { EMPTY_SPEC_FILTERS, SPEC_FILTER_KEYS, specFiltersToParams, parseSpecMultiUrl } from '../inventorySpecFilters';
import SearchableMultiSelect from '../../operation-management/components/SearchableMultiSelect';
import useDebouncedSpecParams from '../hooks/useDebouncedSpecParams';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  exportReturnMasterExcel,
  fetchReturnMasterLaptops,
  fetchReturnMasterOverview,
} from '../inventoryManagementApi';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import TtsplHistoryLink from '../../floor-pipeline/components/TtsplHistoryLink';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  'in_stock', 'reserved', 'in_transit', 'rented', 'on_demo', 'sold',
  'returned', 'in_repair', 'qc_failed', 'scrapped',
];

const LOCATION_OPTIONS = [
  { value: 'customer', label: 'With Customer' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'repair', label: 'Vendor Repair' },
  { value: 'other', label: 'Other' },
];

const STAGE_OPTIONS = [
  'QC1', 'QC2', 'Diagnosis', 'Chip Level Repair', 'Assembly & Software',
  'Final Testing', 'Dispatch QC', 'Floor Manager', 'Pending Inventory', 'Inventory',
];

const RETURN_TYPE_OPTIONS = [
  { value: 'customer_return', label: 'Customer Return' },
  { value: 'repair_pickup', label: 'Repair Pickup' },
  { value: 'replacement_return', label: 'Replacement Return' },
  { value: 'other', label: 'Other Return' },
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

const TABS = [
  { id: 'customers', label: 'Customer-wise return summary' },
  { id: 'laptops', label: 'Returned laptops' },
];

const URL_KEYS = [
  'page', 'tab', 'q', 'status', 'location', 'stage', 'return_type',
  'date_mode', 'month', 'date_from', 'date_to',
  'customer_id', 'warehouse_bucket',
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

const RETURN_TYPE_LABELS = Object.fromEntries(RETURN_TYPE_OPTIONS.map((o) => [o.value, o.label]));

export default function MasterReturnDataPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [kpis, setKpis] = useState({});
  const [customers, setCustomers] = useState([]);
  const [customerOptions, setCustomerOptions] = useState([]);
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
  const tab = searchParams.get('tab') === 'laptops' ? 'laptops' : 'customers';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const search = searchParams.get('q') || '';
  const status = searchParams.get('status') || '';
  const location = searchParams.get('location') || '';
  const stage = searchParams.get('stage') || '';
  const returnType = searchParams.get('return_type') || '';
  const customerId = searchParams.get('customer_id') || '';
  const warehouseBucket = searchParams.get('warehouse_bucket') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const dateMode = searchParams.get('date_mode') || (dateFrom || dateTo ? 'range' : 'month');
  const month = searchParams.get('month') || '';
  const statuses = useMemo(() => readCsvParam(searchParams, 'status'), [status]);
  const locations = useMemo(() => readCsvParam(searchParams, 'location'), [location]);
  const stagesSelected = useMemo(() => readCsvParam(searchParams, 'stage'), [stage]);
  const returnTypes = useMemo(() => readCsvParam(searchParams, 'return_type'), [returnType]);
  const customerIds = useMemo(() => readCsvParam(searchParams, 'customer_id'), [customerId]);
  const warehouseBuckets = useMemo(() => readCsvParam(searchParams, 'warehouse_bucket'), [warehouseBucket]);
  const months = useMemo(() => readCsvParam(searchParams, 'month'), [month]);
  const specFilters = useMemo(() => readSpecFilters(searchParams), [queryKey]);
  const debouncedSpecs = useDebouncedSpecParams(specFilters);

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
    return_type: returnType || undefined,
    customer_id: customerId || undefined,
    warehouse_bucket: warehouseBucket || undefined,
    date_mode: dateMode || undefined,
    month: dateMode === 'month' ? (month || currentMonthValue()) : undefined,
    date_from: dateMode === 'range' ? (dateFrom || undefined) : undefined,
    date_to: dateMode === 'range' ? (dateTo || undefined) : undefined,
    ...specFiltersToParams(debouncedSpecs),
  }), [
    search, status, location, stage, returnType, customerId, warehouseBucket,
    dateMode, month, dateFrom, dateTo, debouncedSpecs,
  ]);

  const loadOverview = useCallback(async () => {
    const reqId = ++overviewReqRef.current;
    setOverviewLoading(true);
    try {
      const { data } = await fetchReturnMasterOverview(filterParams);
      if (reqId !== overviewReqRef.current) return;
      if (!data?.success) throw new Error(data?.message || 'Failed');
      setKpis(data.kpis || {});
      setCustomers(data.customers || []);
      setCustomerOptions(data.customer_options || []);
    } catch (e) {
      if (reqId !== overviewReqRef.current) return;
      toast.error(e.response?.data?.message || e.message || 'Failed to load return master KPIs');
    } finally {
      if (reqId === overviewReqRef.current) setOverviewLoading(false);
    }
  }, [filterParams]);

  const loadList = useCallback(async () => {
    const reqId = ++listReqRef.current;
    setListLoading(true);
    try {
      const { data } = await fetchReturnMasterLaptops({ ...filterParams, page, limit: PAGE_SIZE });
      if (reqId !== listReqRef.current) return;
      if (!data?.success) throw new Error(data?.message || 'Failed');
      setRows(data.data || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (e) {
      if (reqId !== listReqRef.current) return;
      toast.error(e.response?.data?.message || e.message || 'Failed to load returned laptops');
    } finally {
      if (reqId === listReqRef.current) setListLoading(false);
    }
  }, [filterParams, page]);

  useEffect(() => {
    const key = JSON.stringify(filterParams);
    if (lastOverviewKey.current === key) return;
    lastOverviewKey.current = key;
    loadOverview();
  }, [filterParams, loadOverview]);

  useEffect(() => {
    const key = JSON.stringify({ ...filterParams, page });
    if (lastListKey.current === key) return;
    lastListKey.current = key;
    loadList();
  }, [filterParams, page, loadList]);

  const clearFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams({ date_mode: 'month', month: currentMonthValue() }), { replace: true });
  };

  const setSpecFilters = (next) => {
    const value = typeof next === 'function' ? next(specFilters) : next;
    const patch = {};
    SPEC_FILTER_KEYS.forEach((k) => { patch[k] = value?.[k] || ''; });
    patchParams(patch);
  };

  const openCustomer = (id) => {
    patchParams({ customer_id: String(id), tab: 'laptops' });
    listAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleLocation = (key) => {
    const next = locations.length === 1 && locations[0] === key ? [] : [key];
    patchParams({ location: next, warehouse_bucket: '', tab: 'laptops' });
    listAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleBucket = (key) => {
    const next = warehouseBuckets.includes(key) ? [] : [key];
    patchParams({ warehouse_bucket: next, location: 'warehouse', tab: 'laptops' });
    listAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleReturnType = (key) => {
    const next = returnTypes.length === 1 && returnTypes[0] === key ? [] : [key];
    patchParams({ return_type: next, tab: 'laptops' });
    listAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportReturnMasterExcel(filterParams);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const stages = kpis.warehouse_stages || {};
  const returnTypesKpi = kpis.return_types || {};

  const customerTotals = useMemo(() => customers.reduce((acc, c) => ({
    returned_qty: acc.returned_qty + Number(c.returned_qty || 0),
    warehouse_qty: acc.warehouse_qty + Number(c.warehouse_qty || 0),
    customer_qty: acc.customer_qty + Number(c.customer_qty || 0),
    repair_qty: acc.repair_qty + Number(c.repair_qty || 0),
    other_qty: acc.other_qty + Number(c.other_qty || 0),
  }), {
    returned_qty: 0, warehouse_qty: 0, customer_qty: 0, repair_qty: 0, other_qty: 0,
  }), [customers]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master Return Data"
        subtitle="Laptops actually received back from customers, with current location and production stage"
      />

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="TTSPL, serial, customer, Return DC"
            className="flex-1 min-w-[220px]"
          />
          <select
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-w-[9.5rem] min-h-[38px]"
            value={dateMode}
            aria-label="Date filter mode"
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
          >
            {DATE_MODE_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>{o.label}</option>
            ))}
          </select>
          {dateMode === 'month' ? (
            <div className="min-w-[12rem] w-48">
              <SearchableMultiSelect
                id="return-filter-month"
                options={MONTH_OPTIONS}
                value={months.length ? months : [currentMonthValue()]}
                onChange={(vals) => patchParams({
                  date_mode: 'month',
                  month: vals.length ? vals : currentMonthValue(),
                })}
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
          <button type="button" onClick={clearFilters} className="text-sm px-3 py-2 min-h-[38px] border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
            Clear
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || listLoading}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 min-h-[38px] border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Export Excel
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[13rem] w-56">
            <SearchableMultiSelect
              id="return-filter-customer"
              options={customerOptions}
              value={customerIds}
              onChange={(vals) => patchParams({ customer_id: vals })}
              placeholder="All customers"
              countNoun="customer"
              compact
              searchPlaceholder="Search customer…"
            />
          </div>
          <div className="min-w-[11rem] w-44">
            <SearchableMultiSelect
              id="return-filter-status"
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))}
              value={statuses}
              onChange={(vals) => patchParams({ status: vals })}
              placeholder="All statuses"
              countNoun="status"
              compact
              searchPlaceholder="Search status…"
            />
          </div>
          <div className="min-w-[11rem] w-44">
            <SearchableMultiSelect
              id="return-filter-location"
              options={LOCATION_OPTIONS}
              value={locations}
              onChange={(vals) => patchParams({ location: vals })}
              placeholder="All locations"
              countNoun="location"
              compact
              searchPlaceholder="Search location…"
            />
          </div>
          <div className="min-w-[11rem] w-44">
            <SearchableMultiSelect
              id="return-filter-stage"
              options={STAGE_OPTIONS.map((s) => ({ value: s, label: s }))}
              value={stagesSelected}
              onChange={(vals) => patchParams({ stage: vals })}
              placeholder="All stages"
              countNoun="stage"
              compact
              searchPlaceholder="Search stage…"
            />
          </div>
          <div className="min-w-[12rem] w-48">
            <SearchableMultiSelect
              id="return-filter-type"
              options={RETURN_TYPE_OPTIONS}
              value={returnTypes}
              onChange={(vals) => patchParams({ return_type: vals })}
              placeholder="All return types"
              countNoun="type"
              compact
              searchPlaceholder="Search type…"
            />
          </div>
        </div>
        <InventorySpecFilterBar
          filters={specFilters}
          onChange={setSpecFilters}
          onClear={() => setSpecFilters(EMPTY_SPEC_FILTERS)}
        />
        <p className="text-xs text-slate-500">
          Based on <strong>warehouse received date</strong> (or the existing return date if inward is missing). Cards show where those units are <strong>today</strong>.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Total Returned" value={overviewLoading ? '…' : (kpis.total_returned ?? 0)} icon={Laptop} hint="Received in selected period" />
        <StatCard label="Return Value" value={overviewLoading ? '…' : fmtMoney(kpis.total_return_value)} icon={IndianRupee} hint="Purchase rate of returned units" />
        <StatCard
          label="With Customer"
          value={overviewLoading ? '…' : (kpis.customer_count ?? 0)}
          icon={UserRound}
          tone="blue"
          hint="Re-assigned after return"
          onClick={() => toggleLocation('customer')}
          active={locations.length === 1 && locations[0] === 'customer'}
        />
        <StatCard
          label="Warehouse"
          value={overviewLoading ? '…' : (kpis.warehouse_count ?? 0)}
          icon={Building2}
          tone="teal"
          hint="Currently in warehouse / floor"
          onClick={() => toggleLocation('warehouse')}
          active={locations.length === 1 && locations[0] === 'warehouse'}
        />
        <StatCard
          label="Vendor Repair"
          value={overviewLoading ? '…' : (kpis.out_for_repair_count ?? 0)}
          icon={Wrench}
          tone="amber"
          hint="Currently on vendor repair"
          onClick={() => toggleLocation('repair')}
          active={locations.length === 1 && locations[0] === 'repair'}
        />
        <StatCard
          label="Other"
          value={overviewLoading ? '…' : (kpis.other_count ?? 0)}
          icon={RefreshCw}
          hint="Not customer / warehouse / repair"
          onClick={() => toggleLocation('other')}
          active={locations.length === 1 && locations[0] === 'other'}
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Return type</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {RETURN_TYPE_OPTIONS.map((opt) => (
            <StatCard
              key={opt.value}
              label={opt.label}
              value={overviewLoading ? '…' : (returnTypesKpi[opt.value] ?? 0)}
              onClick={() => toggleReturnType(opt.value)}
              active={returnTypes.length === 1 && returnTypes[0] === opt.value}
            />
          ))}
        </div>
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

      <div ref={listAnchorRef} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => patchParams({ tab: t.id }, { resetPage: t.id !== 'laptops' })}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${
                  tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
                {t.id === 'customers' && !overviewLoading ? ` (${customers.length})` : ''}
                {t.id === 'laptops' && !listLoading ? ` (${pagination.total || 0})` : ''}
              </button>
            ))}
          </div>
          {tab === 'laptops' ? (
            <p className="text-xs text-slate-500 pb-2">{pagination.total || 0} laptops</p>
          ) : null}
        </div>

        {tab === 'customers' ? (
        <div className="border rounded-xl overflow-x-auto bg-white">
          {overviewLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading
            </div>
          ) : (
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-right">Returned</th>
                <th className="px-3 py-2 text-right">Warehouse</th>
                <th className="px-3 py-2 text-right">Customer</th>
                <th className="px-3 py-2 text-right">Repair</th>
                <th className="px-3 py-2 text-right">Other</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {customers.map((c) => (
                <tr key={c.customer_id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <button type="button" className="text-blue-700 hover:underline font-medium" onClick={() => openCustomer(c.customer_id)}>
                      {c.customer_name || `#${c.customer_id}`}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">{c.returned_qty}</td>
                  <td className="px-3 py-2 text-right">{c.warehouse_qty}</td>
                  <td className="px-3 py-2 text-right">{c.customer_qty}</td>
                  <td className="px-3 py-2 text-right">{c.repair_qty}</td>
                  <td className="px-3 py-2 text-right">{c.other_qty}</td>
                </tr>
              ))}
              {!customers.length ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No customer returns in this period</td></tr>
              ) : null}
            </tbody>
            {customers.length ? (
              <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                <tr className="font-semibold text-slate-800">
                  <td className="px-3 py-2.5 text-left">Total ({customers.length})</td>
                  <td className="px-3 py-2.5 text-right">{customerTotals.returned_qty}</td>
                  <td className="px-3 py-2.5 text-right">{customerTotals.warehouse_qty}</td>
                  <td className="px-3 py-2.5 text-right">{customerTotals.customer_qty}</td>
                  <td className="px-3 py-2.5 text-right">{customerTotals.repair_qty}</td>
                  <td className="px-3 py-2.5 text-right">{customerTotals.other_qty}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
          )}
        </div>
        ) : null}

        {tab === 'laptops' ? (
        <div className="space-y-2">
        <div className="border rounded-xl overflow-x-auto bg-white">
          {listLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading
            </div>
          ) : (
            <table className="w-full text-sm min-w-[1600px]">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">TTSPL</th>
                  <th className="px-3 py-2 text-left">Serial</th>
                  <th className="px-3 py-2 text-left">Previous Customer</th>
                  <th className="px-3 py-2 text-left">Return Date</th>
                  <th className="px-3 py-2 text-left">Return DC</th>
                  <th className="px-3 py-2 text-left">Return Type</th>
                  <th className="px-3 py-2 text-left">Brand / Model</th>
                  <th className="px-3 py-2 text-left">Specs</th>
                  <th className="px-3 py-2 text-left">Current Status</th>
                  <th className="px-3 py-2 text-left">Current Location</th>
                  <th className="px-3 py-2 text-left">Current Customer</th>
                  <th className="px-3 py-2 text-left">Production Stage</th>
                  <th className="px-3 py-2 text-left">Last Movement</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.serial_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">
                      <TtsplHistoryLink ttsplId={r.ttspl_id} onOpen={setHistoryTtspl} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.serial_number || '—'}</td>
                    <td className="px-3 py-2">{r.previous_customer_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.return_date)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.return_dc_number || '—'}</td>
                    <td className="px-3 py-2">{RETURN_TYPE_LABELS[r.return_type] || r.return_type || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.brand || '—'}</div>
                      <div className="text-xs text-slate-500">{r.model || ''}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {[r.generation, r.processor, r.ram, r.storage, r.graphics, r.screen_size].filter(Boolean).join(' | ') || '—'}
                    </td>
                    <td className="px-3 py-2 capitalize">{String(r.current_status || '').replace(/_/g, ' ') || '—'}</td>
                    <td className="px-3 py-2">{r.location_label || r.current_location || '—'}</td>
                    <td className="px-3 py-2">{r.customer_name || '—'}</td>
                    <td className="px-3 py-2">{r.current_stage || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.last_movement_date)}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr><td colSpan={13} className="px-3 py-8 text-center text-slate-400">No returned laptops in this period</td></tr>
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
        ) : null}
      </div>

      <TtsplHistoryDrawer
        ttsplId={historyTtspl}
        open={Boolean(historyTtspl)}
        onClose={() => setHistoryTtspl(null)}
      />
    </div>
  );
}
