import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Building2, FileSpreadsheet, HardDrive, IndianRupee, Laptop, Loader2, Users, Wrench,
} from 'lucide-react';
import { PageHeader, StatCard, SearchField, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import InventorySpecFilterBar from '../components/InventorySpecFilterBar';
import { EMPTY_SPEC_FILTERS, SPEC_FILTER_KEYS, specFiltersToParams, parseSpecMultiUrl } from '../inventorySpecFilters';
import SearchableMultiSelect from '../../operation-management/components/SearchableMultiSelect';
import useDebouncedSpecParams from '../hooks/useDebouncedSpecParams';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  exportMasterDataExcel,
  fetchMasterDataColumnValues,
  fetchMasterDataDashboard,
  fetchMasterDataKpis,
  setVendorExcludeFromVendorPo,
} from '../inventoryManagementApi';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import TtsplHistoryLink from '../../floor-pipeline/components/TtsplHistoryLink';
import { salesOrderDetailPath } from '../../sales-pipeline/salesOrderScope';
import { deliveryChallanDetailPath } from '../../sales-pipeline/salesPipelineUtils';
import SheetsColumnFilter from '../../../components/ui/SheetsColumnFilter';
import {
  clearColumnFilterParams,
  columnFiltersToParams,
  LAPTOP_TABLE_COLUMNS,
  MD_COLUMN_TYPES,
  readColumnFiltersFromParams,
} from '../masterDataColumnFilters';

const PAGE_SIZE = 25;
const TABS = [
  { id: 'laptops', label: 'Laptop Master' },
  { id: 'customers', label: 'Customers' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'floor', label: 'Floor' },
];

const STATUS_OPTIONS = [
  'in_stock', 'reserved', 'in_transit', 'rented', 'on_demo', 'sold',
  'returned', 'in_repair', 'qc_failed', 'scrapped',
];

const LOCATION_OPTIONS = ['Inventory', 'Customer', 'Floor', 'Vendor'];

const ENTITY_OPTIONS = [
  { value: 'rentfoxxy', label: 'Rentfoxxy' },
  { value: 'gorefurbo', label: 'Gorefurbo' },
];

const DEFAULT_STAGE_OPTIONS = ['Floor Manager', 'Pending Inventory', 'Inventory'];

function readCsvParam(sp, key) {
  return String(sp.get(key) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Query keys synced to the URL so filters survive detail navigation + back. */
const URL_KEYS = [
  'tab', 'page', 'q', 'status', 'location', 'stage', 'entity', 'pricing_type',
  'date_mode', 'month', 'date_from', 'date_to',
  'customer_id', 'vendor_id', 'from_vendor', 'ready', 'qc_process',
  ...SPEC_FILTER_KEYS,
];

const DATE_MODE_OPTIONS = [
  { value: '', label: 'All time' },
  { value: 'month', label: 'By month' },
  { value: 'range', label: 'Custom date range' },
];

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

function formatMonthLabel(yyyyMm) {
  if (!/^\d{4}-\d{2}$/.test(yyyyMm || '')) return yyyyMm || '';
  const d = new Date(`${yyyyMm}-01T12:00:00+05:30`);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

const MONTH_OPTIONS = buildMonthOptions();

const PRICING_TYPE_OPTIONS = [
  { value: 'sale', label: 'Sale' },
  { value: 'rental', label: 'Rental' },
];

function readSpecFilters(sp) {
  const next = { ...EMPTY_SPEC_FILTERS };
  SPEC_FILTER_KEYS.forEach((k) => {
    next[k] = parseSpecMultiUrl(sp.get(k)).join(',');
  });
  return next;
}

const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function summarizeVendorPoTotals(rows = []) {
  return rows.reduce(
    (acc, row) => {
      const excluded = Boolean(row.exclude_from_vendor_po);
      const laptops = Number(row.purchased_laptops || 0);
      const value = Number(row.purchase_value || 0);
      if (excluded) {
        acc.total_excluded_vendors += 1;
        acc.total_excluded_laptops += laptops;
        acc.total_excluded_purchase_value += value;
        return acc;
      }
      acc.total_vendors += 1;
      acc.total_purchased_laptops += laptops;
      acc.total_purchase_value += value;
      return acc;
    },
    {
      total_vendors: 0,
      total_purchased_laptops: 0,
      total_purchase_value: 0,
      total_excluded_vendors: 0,
      total_excluded_laptops: 0,
      total_excluded_purchase_value: 0,
    },
  );
}

function fmtCustomerPrice(r) {
  if (r.customer_price == null) return '—';
  const label = r.customer_price_type === 'sale' ? 'Sale' : 'Rent/mo';
  return `${fmtMoney(r.customer_price)} (${label})`;
}

function fmtVendorPrice(r) {
  if (r.vendor_purchase_price == null) return '—';
  if (r.vendor_price_type === 'monthly') {
    return `${fmtMoney(r.vendor_purchase_price)} (Rent/mo)`;
  }
  if (r.vendor_price_type === 'purchase') {
    return `${fmtMoney(r.vendor_purchase_price)} (Purchase)`;
  }
  return fmtMoney(r.vendor_purchase_price);
}

/** Single-cell laptop specs card: Brand - Model | screen, then pipe-separated specs */
function LaptopSpecsCard({ row }) {
  const title = [row.brand, row.model].filter(Boolean).join(' - ');
  const screen = row.screen_size
    ? (/inch/i.test(row.screen_size) ? row.screen_size : `${row.screen_size}-inch`)
    : null;
  const specLine = [
    row.processor,
    row.generation,
    row.ram,
    row.storage,
    row.graphics,
  ].filter(Boolean).join(' | ');

  if (!title && !screen && !specLine) {
    return <span className="text-slate-400">—</span>;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm min-w-[200px] max-w-[280px]">
      {title || screen ? (
        <p className="font-semibold text-slate-900 text-xs leading-snug">
          {title || '—'}
          {screen ? <span className="font-normal text-slate-600"> | {screen}</span> : null}
        </p>
      ) : null}
      {specLine ? (
        <p className="mt-0.5 text-[11px] text-slate-600 leading-relaxed">{specLine}</p>
      ) : null}
    </div>
  );
}

function DocLink({ to, children }) {
  if (!to || !children || children === '—') {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <Link to={to} className="text-blue-700 hover:underline font-mono" title="Open details">
      {children}
    </Link>
  );
}

function soHref(row) {
  if (!row.sales_order_number) return null;
  const qt = String(row.quotation_type || row.customer_price_type || '').toLowerCase();
  const scope = (qt.includes('sale') || qt === 'sales') ? 'sale' : 'rental';
  return salesOrderDetailPath(row.sales_order_number, scope);
}

function dcHref(row) {
  return row.delivery_challan_number ? deliveryChallanDetailPath(row.delivery_challan_number) : null;
}

function poHref(row) {
  return row.po_id ? `/vendor-management/purchase-orders/${row.po_id}/receive` : null;
}

function grnHref(row) {
  if (!row.po_id || !row.grn_id) return null;
  return `/vendor-management/purchase-orders/${row.po_id}/grn-detail`;
}

export default function MasterDataDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [kpis, setKpis] = useState({});
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerTotals, setCustomerTotals] = useState({});
  const [vendors, setVendors] = useState([]);
  const [vendorTotals, setVendorTotals] = useState({});
  const [stages, setStages] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [historyTtspl, setHistoryTtspl] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [excludingVendorId, setExcludingVendorId] = useState(null);
  const [stageOptions, setStageOptions] = useState(DEFAULT_STAGE_OPTIONS);
  const kpiReqRef = useRef(0);
  const tabReqRef = useRef(0);

  // Local search box; debounced value is written into the URL.
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 350);

  const tab = searchParams.get('tab') || 'laptops';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const search = searchParams.get('q') || '';
  const statuses = readCsvParam(searchParams, 'status');
  const locations = readCsvParam(searchParams, 'location');
  const stagesSelected = readCsvParam(searchParams, 'stage');
  const entities = readCsvParam(searchParams, 'entity');
  const pricingTypes = readCsvParam(searchParams, 'pricing_type');
  const customerIds = readCsvParam(searchParams, 'customer_id');
  const vendorIds = readCsvParam(searchParams, 'vendor_id');
  const status = statuses.join(',');
  const location = locations.join(',');
  const stage = stagesSelected.join(',');
  const entity = entities.join(',');
  const pricingType = pricingTypes.join(',');
  const customerId = customerIds.join(',');
  const vendorId = vendorIds.join(',');
  const fromVendor = searchParams.get('from_vendor') === '1';
  const ready = searchParams.get('ready') === '1';
  const qcProcess = searchParams.get('qc_process') === '1';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const dateMode = searchParams.get('date_mode') || (dateFrom || dateTo ? 'range' : '');
  const months = readCsvParam(searchParams, 'month');
  const month = months.join(',');
  const specFilters = useMemo(() => readSpecFilters(searchParams), [searchParams]);
  const debouncedSpecs = useDebouncedSpecParams(specFilters);
  const queryKey = searchParams.toString();
  const columnFilters = useMemo(() => readColumnFiltersFromParams(searchParams), [queryKey]);
  const columnFilterParams = useMemo(() => columnFiltersToParams(columnFilters), [columnFilters]);

  const patchParams = useCallback((patch, { resetPage = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const apply = { ...patch };
      if (resetPage && !Object.prototype.hasOwnProperty.call(apply, 'page')) {
        apply.page = 1;
      }
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

  // Keep URL `q` in sync with the debounced search box.
  useEffect(() => {
    const current = searchParams.get('q') || '';
    if (debouncedSearch === current) return;
    patchParams({ q: debouncedSearch || '' });
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // When landing via back/forward with a different `q`, refresh the input.
  useEffect(() => {
    const q = searchParams.get('q') || '';
    setSearchInput((prev) => (prev.trim() === q ? prev : q));
  }, [searchParams]);

  const kpiFilterParams = useMemo(() => ({
    search: search || undefined,
    status: status || undefined,
    location: location || undefined,
    stage: stage || undefined,
    entity: entity || undefined,
    pricing_type: pricingType || undefined,
    date_mode: dateMode || undefined,
    month: dateMode === 'month' ? (month || currentMonthValue()) : undefined,
    date_from: dateMode === 'range' ? (dateFrom || undefined) : undefined,
    date_to: dateMode === 'range' ? (dateTo || undefined) : undefined,
    ...specFiltersToParams(debouncedSpecs),
  }), [search, status, location, stage, entity, pricingType, dateMode, month, dateFrom, dateTo, debouncedSpecs]);

  const tabFilterParams = useMemo(() => ({
    tab,
    page,
    limit: PAGE_SIZE,
    search: search || undefined,
    status: status || undefined,
    location: location || undefined,
    stage: stage || undefined,
    entity: entity || undefined,
    pricing_type: pricingType || undefined,
    date_mode: dateMode || undefined,
    month: dateMode === 'month' ? (month || currentMonthValue()) : undefined,
    date_from: dateMode === 'range' ? (dateFrom || undefined) : undefined,
    date_to: dateMode === 'range' ? (dateTo || undefined) : undefined,
    customer_id: customerId || undefined,
    vendor_id: vendorId || undefined,
    from_vendor: fromVendor ? '1' : undefined,
    ready: ready ? '1' : undefined,
    qc_process: qcProcess ? '1' : undefined,
    ...specFiltersToParams(debouncedSpecs),
  }), [
    tab, page, search, status, location, stage, entity, pricingType, dateMode, month,
    dateFrom, dateTo, customerId, vendorId, fromVendor, ready, qcProcess, debouncedSpecs,
  ]);

  const listFilterParams = useMemo(() => ({
    ...tabFilterParams,
    ...columnFilterParams,
  }), [tabFilterParams, columnFilterParams]);

  const loadKpis = useCallback(async () => {
    const reqId = ++kpiReqRef.current;
    setKpiLoading(true);
    try {
      const { data } = await fetchMasterDataKpis(kpiFilterParams);
      if (reqId !== kpiReqRef.current) return;
      if (!data?.success) throw new Error(data?.message || 'Failed');
      setKpis(data.kpis || {});
    } catch (e) {
      if (reqId !== kpiReqRef.current) return;
      toast.error(e.response?.data?.message || e.message || 'Failed to load KPIs');
    } finally {
      if (reqId === kpiReqRef.current) setKpiLoading(false);
    }
  }, [kpiFilterParams]);

  const loadTab = useCallback(async () => {
    const reqId = ++tabReqRef.current;
    setLoading(true);
    const params = tab === 'laptops' ? listFilterParams : tabFilterParams;
    try {
      const { data } = await fetchMasterDataDashboard(params);
      if (reqId !== tabReqRef.current) return;
      if (!data?.success) throw new Error(data?.message || 'Failed');
      if (data.tab === 'laptops') {
        setRows(data.data || []);
        setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
      } else if (data.tab === 'customers') {
        setCustomers(data.customers || []);
        setCustomerTotals(data.totals || {});
      } else if (data.tab === 'vendors') {
        setVendors(data.vendors || []);
        setVendorTotals(data.totals || {});
      } else if (data.tab === 'floor') {
        setStages(data.stages || []);
      }
    } catch (e) {
      if (reqId !== tabReqRef.current) return;
      toast.error(e.response?.data?.message || e.message || 'Failed to load master data');
    } finally {
      if (reqId === tabReqRef.current) setLoading(false);
    }
  }, [tab, listFilterParams, tabFilterParams]);

  useEffect(() => { loadKpis(); }, [loadKpis]);
  useEffect(() => { loadTab(); }, [loadTab]);

  const fetchColumnOptions = useCallback(async (columnKey) => {
    const { data } = await fetchMasterDataColumnValues({ ...listFilterParams, column: columnKey });
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

  useEffect(() => {
    fetchMasterDataDashboard({ tab: 'floor' })
      .then(({ data }) => {
        const names = (data?.stages || []).map((s) => s.stage_name).filter(Boolean);
        if (names.length) {
          setStageOptions([...new Set([...DEFAULT_STAGE_OPTIONS, ...names])]);
        }
      })
      .catch(() => {});
  }, []);

  const openCustomer = (id) => {
    patchParams({
      customer_id: String(id),
      vendor_id: '',
      from_vendor: false,
      ready: false,
      qc_process: false,
      location: 'Customer',
      tab: 'laptops',
    });
  };
  const openVendor = (id) => {
    patchParams({
      vendor_id: String(id),
      customer_id: '',
      from_vendor: false,
      ready: false,
      qc_process: false,
      location: '',
      tab: 'laptops',
    });
  };
  const openSaleList = () => {
    patchParams({
      pricing_type: 'sale',
      tab: 'laptops',
      customer_id: '',
      vendor_id: '',
      from_vendor: false,
      ready: false,
      qc_process: false,
      location: '',
      status: '',
      stage: '',
    });
  };
  const openRentalList = () => {
    patchParams({
      pricing_type: 'rental',
      tab: 'laptops',
      customer_id: '',
      vendor_id: '',
      from_vendor: false,
      ready: false,
      qc_process: false,
      location: '',
      status: '',
      stage: '',
    });
  };
  const openAllLaptops = () => {
    patchParams({
      customer_id: '',
      vendor_id: '',
      from_vendor: false,
      ready: false,
      qc_process: false,
      pricing_type: '',
      status: '',
      stage: '',
      location: '',
      tab: 'laptops',
    });
  };
  const openWithCustomerList = () => {
    patchParams({
      customer_id: '',
      vendor_id: '',
      from_vendor: false,
      ready: false,
      qc_process: false,
      status: '',
      stage: '',
      location: 'Customer',
      tab: 'laptops',
    });
  };
  const openFromVendorList = () => {
    patchParams({
      customer_id: '',
      vendor_id: '',
      from_vendor: true,
      ready: false,
      qc_process: false,
      status: '',
      stage: '',
      location: '',
      tab: 'laptops',
    });
  };
  const openReadyToRentSale = () => {
    patchParams({
      customer_id: '',
      vendor_id: '',
      from_vendor: false,
      ready: true,
      qc_process: false,
      status: '',
      stage: '',
      location: '',
      tab: 'laptops',
    });
  };
  const openQcProcess = () => {
    patchParams({
      customer_id: '',
      vendor_id: '',
      from_vendor: false,
      ready: false,
      qc_process: true,
      status: '',
      stage: '',
      location: '',
      tab: 'laptops',
    });
  };
  const openStage = (stageName) => {
    if (stageName === 'Inventory') {
      patchParams({
        location: 'Inventory', stage: '', status: 'in_stock', from_vendor: false, ready: false, qc_process: false, tab: 'laptops',
      });
    } else if (stageName === 'Pending Inventory') {
      patchParams({
        stage: '', location: 'Floor', from_vendor: false, ready: false, qc_process: false, tab: 'laptops',
      });
    } else {
      patchParams({
        stage: stageName, location: 'Floor', status: '', from_vendor: false, ready: false, qc_process: false, tab: 'laptops',
      });
    }
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      const keepTab = prev.get('tab');
      if (keepTab && keepTab !== 'laptops') next.set('tab', keepTab);
      return next;
    }, { replace: true });
  };

  const setSpecFilters = (next) => {
    const value = typeof next === 'function' ? next(specFilters) : next;
    const patch = {};
    SPEC_FILTER_KEYS.forEach((k) => { patch[k] = value?.[k] || ''; });
    patchParams(patch);
  };

  const toggleVendorPoExclusion = async (vendor, nextExclude) => {
    const vendorId = vendor.vendor_id;
    const prevVendors = vendors;
    const nextVendors = vendors.map((row) => (
      row.vendor_id === vendorId ? { ...row, exclude_from_vendor_po: nextExclude } : row
    ));
    setVendors(nextVendors);
    setVendorTotals(summarizeVendorPoTotals(nextVendors));
    setExcludingVendorId(vendorId);
    try {
      const { data } = await setVendorExcludeFromVendorPo(vendorId, nextExclude);
      if (!data?.success) throw new Error(data?.message || 'Failed');
      const saved = data.vendor?.exclude_from_vendor_po === true;
      setVendors((curr) => {
        const synced = curr.map((row) => (
          row.vendor_id === vendorId ? { ...row, exclude_from_vendor_po: saved } : row
        ));
        setVendorTotals(summarizeVendorPoTotals(synced));
        return synced;
      });
      toast.success(saved
        ? 'Vendor excluded from Vendor PO listing and totals'
        : 'Vendor included in Vendor PO listing and totals');
      loadKpis();
    } catch (e) {
      setVendors(prevVendors);
      setVendorTotals(summarizeVendorPoTotals(prevVendors));
      toast.error(e.response?.data?.message || e.message || 'Failed to update vendor exclusion');
    } finally {
      setExcludingVendorId(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = tab === 'laptops' ? listFilterParams : tabFilterParams;
      const { page: _page, limit: _limit, ...exportParams } = params;
      await exportMasterDataExcel(exportParams);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master Data Dashboard"
        subtitle="360° view of every laptop — purchase to customer assignment"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard
          label="Total Laptops"
          value={kpiLoading ? '…' : (kpis.total_laptops ?? '—')}
          icon={Laptop}
          hint="Every laptop on a purchase order"
          onClick={openAllLaptops}
          active={tab === 'laptops' && !location && !fromVendor && !ready && !qcProcess && !customerId && !vendorId && !pricingType}
        />
        <StatCard
          label="With Customers"
          value={kpiLoading ? '…' : (kpis.total_active_customer_assets ?? '—')}
          icon={HardDrive}
          tone="teal"
          hint="Rent / demo / sold / in transit"
          onClick={openWithCustomerList}
          active={locations.length === 1 && locations[0] === 'Customer' && tab === 'laptops' && !fromVendor && !ready && !qcProcess && !pricingType}
        />
        <StatCard
          label="From Vendors"
          value={kpiLoading ? '…' : (kpis.total_from_vendors ?? '—')}
          icon={Building2}
          tone="purple"
          hint="Counted vendor POs (exclusions hidden)"
          onClick={openFromVendorList}
          active={fromVendor && tab === 'laptops' && !ready && !qcProcess && !pricingType}
        />
        <StatCard
          label="Customers"
          value={kpiLoading ? '…' : (kpis.total_customers ?? '—')}
          icon={Users}
          hint="In current filters"
        />
        <StatCard
          label="Vendors"
          value={kpiLoading ? '…' : (kpis.total_vendors ?? '—')}
          icon={Building2}
          hint="In current filters"
        />
        <StatCard
          label="QC Process"
          value={kpiLoading ? '…' : (kpis.total_qc_process ?? '—')}
          icon={Wrench}
          tone="amber"
          hint="Not ready — floor / QC / repair / inventory"
          onClick={openQcProcess}
          active={qcProcess && tab === 'laptops'}
        />
        <StatCard
          label="Ready to Rent/Sale"
          value={kpiLoading ? '…' : (kpis.total_ready_to_rent_sale ?? '—')}
          tone="green"
          hint="In stock + QC passed"
          onClick={openReadyToRentSale}
          active={ready && tab === 'laptops'}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Sale Laptops"
          value={kpiLoading ? '…' : (kpis.total_sale_units ?? '—')}
          icon={IndianRupee}
          tone="red"
          hint="Sold or sale quotation"
          onClick={openSaleList}
          active={pricingTypes.length === 1 && pricingTypes[0] === 'sale' && tab === 'laptops'}
        />
        <StatCard
          label="Total Sale Value"
          value={kpiLoading ? '…' : fmtMoney(kpis.total_sale_value)}
          icon={IndianRupee}
          tone="red"
          hint="Sum of sale prices (filtered)"
          onClick={openSaleList}
          active={pricingTypes.length === 1 && pricingTypes[0] === 'sale' && tab === 'laptops'}
        />
        <StatCard
          label="Rental Laptops"
          value={kpiLoading ? '…' : (kpis.total_rental_units ?? '—')}
          icon={IndianRupee}
          tone="blue"
          hint="Rental / demo deployments"
          onClick={openRentalList}
          active={pricingTypes.length === 1 && pricingTypes[0] === 'rental' && tab === 'laptops'}
        />
        <StatCard
          label="Monthly Rental Value"
          value={kpiLoading ? '…' : fmtMoney(kpis.total_monthly_rental_value)}
          icon={IndianRupee}
          tone="blue"
          hint="Active rental monthly total"
          onClick={openRentalList}
          active={pricingTypes.length === 1 && pricingTypes[0] === 'rental' && tab === 'laptops'}
        />
      </div>

      {(location || fromVendor || ready || qcProcess || pricingType || dateMode) && tab === 'laptops' ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2">
          <span className="font-semibold text-teal-800">
            {dateMode === 'month'
              ? `Showing laptops for ${(months.length ? months : [currentMonthValue()]).map(formatMonthLabel).join(', ')} (delivery / rent start / GRN date, IST)`
              : dateMode === 'range' && (dateFrom || dateTo)
                ? `Showing laptops ${dateFrom || '…'} to ${dateTo || '…'} (IST activity dates)`
                : pricingTypes.length === 1 && pricingTypes[0] === 'sale'
                  ? 'Showing sale laptops only'
                  : pricingTypes.length === 1 && pricingTypes[0] === 'rental'
                    ? 'Showing rental laptops only'
                    : qcProcess
                      ? 'Showing QC process laptops (not ready to rent/sale)'
                      : ready
                        ? 'Showing ready to rent/sale laptops'
                        : locations.includes('Customer')
                          ? 'Showing laptops with customers'
                          : 'Showing laptops sourced from vendors'}
          </span>
          <button type="button" onClick={clearFilters} className="ml-auto text-teal-700 hover:underline font-medium">
            Clear filter
          </button>
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <SearchField
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search TTSPL, serial, customer, vendor, SO, DC, PO…"
            className="flex-1 min-w-[220px]"
          />
          <div className="min-w-[11rem] w-44">
            <SearchableMultiSelect
              id="md-filter-status"
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
              id="md-filter-location"
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
              id="md-filter-stage"
              value={stagesSelected}
              onChange={(vals) => patchParams({ stage: vals })}
              options={stageOptions}
              placeholder="All stages"
              countNoun="stage"
              compact
              searchPlaceholder="Search stage…"
            />
          </div>
          <div className="min-w-[10rem] w-40">
            <SearchableMultiSelect
              id="md-filter-pricing"
              value={pricingTypes}
              onChange={(vals) => patchParams({ pricing_type: vals })}
              options={PRICING_TYPE_OPTIONS}
              placeholder="All types"
              countNoun="type"
              compact
              searchPlaceholder="Search type…"
            />
          </div>
          <div className="min-w-[10rem] w-40">
            <SearchableMultiSelect
              id="md-filter-entity"
              value={entities}
              onChange={(vals) => patchParams({ entity: vals })}
              options={ENTITY_OPTIONS}
              placeholder="All entities"
              countNoun="entity"
              compact
              searchPlaceholder="Search entity…"
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
                  month: month || currentMonthValue(),
                  date_from: '',
                  date_to: '',
                });
              } else if (next === 'range') {
                patchParams({
                  date_mode: 'range',
                  month: '',
                });
              } else {
                patchParams({
                  date_mode: '',
                  month: '',
                  date_from: '',
                  date_to: '',
                });
              }
            }}
            aria-label="Date filter mode"
          >
            {DATE_MODE_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {dateMode === 'month' ? (
            <div className="min-w-[11rem] w-44">
              <SearchableMultiSelect
                id="md-filter-month"
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
        </div>
        <InventorySpecFilterBar
          filters={specFilters}
          onChange={setSpecFilters}
          onClear={() => setSpecFilters(EMPTY_SPEC_FILTERS)}
        />
        {(customerId || vendorId) ? (
          <p className="text-xs text-slate-500">
            Drill-down active
            {customerId ? ` · customer #${customerId}` : ''}
            {vendorId ? ` · vendor #${vendorId}` : ''}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-0">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => patchParams({ tab: t.id })}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-1 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          Export Excel
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      ) : null}

      {!loading && tab === 'laptops' ? (
        <>
          <p className="text-xs text-slate-500">
            Each laptop shows its <strong>current</strong> customer, sourcing <strong>vendor</strong>,
            vendor purchase type (<strong>Rental</strong> / <strong>Direct Purchase</strong>),
            vendor price (rent/mo when rental), and <strong>customer price</strong>.
            SO / DC / customer price appear only while the laptop is currently with a customer — not after return to inventory.
          </p>
          <div className="border rounded-xl overflow-x-auto bg-white">
            <table className="w-full text-xs min-w-[1200px]">
              <thead className="bg-slate-50 text-slate-500 uppercase">
                <tr>
                  {LAPTOP_TABLE_COLUMNS.map((col) => (
                    <SheetsColumnFilter
                      key={col.key}
                      columnKey={col.key}
                      label={col.label}
                      filterType={MD_COLUMN_TYPES[col.key] || 'text'}
                      align={col.align}
                      className={`px-2 py-2 whitespace-nowrap ${col.highlight ? 'bg-teal-50 text-teal-800' : ''}`}
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
                  <tr key={r.serial_id} className="hover:bg-slate-50/80">
                    <td className="px-2 py-2">
                      <TtsplHistoryLink ttsplId={r.ttspl_id} onOpen={setHistoryTtspl} />
                    </td>
                    <td className="px-2 py-2">
                      {r.serial_number && r.ttspl_id ? (
                        <TtsplHistoryLink ttsplId={r.ttspl_id} label={r.serial_number} onOpen={setHistoryTtspl} />
                      ) : (r.serial_number || '—')}
                    </td>
                    <td className="px-2 py-2">
                      <LaptopSpecsCard row={r} />
                    </td>
                    <td className="px-2 py-2 capitalize">{String(r.current_status || '').replace(/_/g, ' ') || '—'}</td>
                    <td className="px-2 py-2">{r.current_location || '—'}</td>
                    <td className="px-2 py-2 bg-teal-50/40">
                      {r.customer_id ? (
                        <Link to={`/lead-crm/customers/${r.customer_id}`} className="text-blue-700 hover:underline font-medium">
                          {r.customer_name || `#${r.customer_id}`}
                        </Link>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-2 py-2 bg-teal-50/40 font-medium">{r.vendor_name || '—'}</td>
                    <td className="px-2 py-2 bg-teal-50/40 whitespace-nowrap font-medium">
                      {r.purchase_order_type_label || '—'}
                    </td>
                    <td className="px-2 py-2 bg-teal-50/40 whitespace-nowrap font-semibold">
                      {fmtVendorPrice(r)}
                    </td>
                    <td className="px-2 py-2 bg-teal-50/40 whitespace-nowrap font-semibold">
                      {fmtCustomerPrice(r)}
                    </td>
                    <td className="px-2 py-2">{r.current_stage || '—'}</td>
                    <td className="px-2 py-2">
                      <DocLink to={soHref(r)}>{r.sales_order_number || '—'}</DocLink>
                    </td>
                    <td className="px-2 py-2">
                      <DocLink to={dcHref(r)}>{r.delivery_challan_number || '—'}</DocLink>
                    </td>
                    <td className="px-2 py-2">
                      <DocLink to={poHref(r)}>{r.purchase_order_number || '—'}</DocLink>
                    </td>
                    <td className="px-2 py-2">
                      <DocLink to={grnHref(r)}>{r.grn_number || '—'}</DocLink>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr><td colSpan={15} className="px-3 py-10 text-center text-slate-400">No laptops match filters</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <ListPagination
            page={page}
            totalPages={pagination.totalPages || 1}
            total={pagination.total || 0}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => patchParams({ page: p }, { resetPage: false })}
          />
        </>
      ) : null}

      {!loading && tab === 'customers' ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Click a customer to open their laptops with <strong>vendor</strong>, <strong>vendor type</strong>, <strong>vendor price</strong>, and <strong>customer price</strong> on each row.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Customers (filtered)" value={customerTotals.total_customers ?? 0} />
            <StatCard label="Active Laptops" value={customerTotals.total_active_laptops ?? 0} />
            <StatCard label="Returned" value={customerTotals.total_returned_laptops ?? 0} />
            <StatCard label="Monthly Rental Value" value={fmtMoney(customerTotals.total_monthly_rental_value)} />
            <StatCard label="Sale Value" value={fmtMoney(customerTotals.total_sale_value)} />
          </div>
          <div className="border rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-right">Active</th>
                  <th className="px-3 py-2 text-right">Returned</th>
                  <th className="px-3 py-2 text-right">Monthly Rent</th>
                  <th className="px-3 py-2 text-right">Sale Value</th>
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
                    <td className="px-3 py-2 text-right">{c.active_laptops}</td>
                    <td className="px-3 py-2 text-right">{c.returned_laptops}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(c.monthly_rental_value)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(c.sale_value)}</td>
                  </tr>
                ))}
                {!customers.length ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No customer assets</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && tab === 'vendors' ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Click a vendor to open purchased laptops with <strong>current customer</strong> (if assigned) and both prices.
            Check <strong>Exclude from Vendor PO</strong> to keep the vendor and inventory, but drop that vendor from Vendor PO listing and purchase totals.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Vendors (Vendor PO)" value={vendorTotals.total_vendors ?? 0} />
            <StatCard label="Purchased Laptops" value={vendorTotals.total_purchased_laptops ?? 0} />
            <StatCard label="Purchase Value" value={fmtMoney(vendorTotals.total_purchase_value)} />
          </div>
          {(vendorTotals.total_excluded_vendors || 0) > 0 ? (
            <p className="text-xs text-slate-500">
              {vendorTotals.total_excluded_vendors} vendor{vendorTotals.total_excluded_vendors === 1 ? '' : 's'} excluded from Vendor PO
              {' '}({vendorTotals.total_excluded_laptops || 0} laptops, {fmtMoney(vendorTotals.total_excluded_purchase_value)} not counted).
            </p>
          ) : null}
          <div className="border rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-right">Laptops</th>
                  <th className="px-3 py-2 text-right">Purchase Value</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Exclude from Vendor PO</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {vendors.map((v) => {
                  const excluded = Boolean(v.exclude_from_vendor_po);
                  const busy = excludingVendorId === v.vendor_id;
                  return (
                    <tr key={v.vendor_id} className={excluded ? 'bg-slate-50/80 text-slate-500' : 'hover:bg-slate-50'}>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" className="text-blue-700 hover:underline font-medium" onClick={() => openVendor(v.vendor_id)}>
                            {v.vendor_name || `#${v.vendor_id}`}
                          </button>
                          {excluded ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                              Excluded
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">{v.purchased_laptops}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(v.purchase_value)}</td>
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                            checked={excluded}
                            disabled={busy}
                            onChange={(e) => toggleVendorPoExclusion(v, e.target.checked)}
                          />
                          <span>{excluded ? 'Excluded' : 'Exclude'}</span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
                {!vendors.length ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">No vendors</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && tab === 'floor' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {stages.map((s) => (
            <button
              key={s.stage_name}
              type="button"
              onClick={() => openStage(s.stage_name)}
              className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition"
            >
              <p className="text-xs font-medium text-slate-500 uppercase">{s.stage_name}</p>
              <p className="text-2xl font-semibold text-slate-900 mt-1">{s.count}</p>
            </button>
          ))}
          {!stages.length ? <p className="text-slate-400 col-span-full py-8 text-center">No floor stages</p> : null}
        </div>
      ) : null}

      <TtsplHistoryDrawer
        ttsplId={historyTtspl}
        open={Boolean(historyTtspl)}
        onClose={() => setHistoryTtspl(null)}
      />
    </div>
  );
}
