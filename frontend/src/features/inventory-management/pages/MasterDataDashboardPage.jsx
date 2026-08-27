import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Building2, HardDrive, IndianRupee, Laptop, Loader2, Users, Wrench,
} from 'lucide-react';
import { PageHeader, StatCard, SearchField, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import InventorySpecFilterBar from '../components/InventorySpecFilterBar';
import { EMPTY_SPEC_FILTERS, SPEC_FILTER_KEYS, specFiltersToParams } from '../inventorySpecFilters';
import useDebouncedSpecParams from '../hooks/useDebouncedSpecParams';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { fetchMasterDataDashboard, fetchMasterDataKpis } from '../inventoryManagementApi';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import TtsplHistoryLink from '../../floor-pipeline/components/TtsplHistoryLink';
import { salesOrderDetailPath } from '../../sales-pipeline/salesOrderScope';
import { deliveryChallanDetailPath } from '../../sales-pipeline/salesPipelineUtils';

const PAGE_SIZE = 25;
const TABS = [
  { id: 'laptops', label: 'Laptop Master' },
  { id: 'customers', label: 'Customers' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'floor', label: 'Floor' },
];

const STATUS_OPTIONS = [
  '', 'in_stock', 'reserved', 'in_transit', 'rented', 'on_demo', 'sold',
  'returned', 'in_repair', 'qc_failed', 'scrapped',
];

const LOCATION_OPTIONS = ['', 'Inventory', 'Customer', 'Floor', 'Vendor'];

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
  { value: '', label: 'All commercial types' },
  { value: 'sale', label: 'Sale only' },
  { value: 'rental', label: 'Rental only' },
];

function readSpecFilters(sp) {
  const next = { ...EMPTY_SPEC_FILTERS };
  SPEC_FILTER_KEYS.forEach((k) => {
    next[k] = sp.get(k) || '';
  });
  return next;
}

const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

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

  // Local search box; debounced value is written into the URL.
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 350);

  const tab = searchParams.get('tab') || 'laptops';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const search = searchParams.get('q') || '';
  const status = searchParams.get('status') || '';
  const location = searchParams.get('location') || '';
  const stage = searchParams.get('stage') || '';
  const entity = searchParams.get('entity') || '';
  const pricingType = searchParams.get('pricing_type') || '';
  const customerId = searchParams.get('customer_id') || '';
  const vendorId = searchParams.get('vendor_id') || '';
  const fromVendor = searchParams.get('from_vendor') === '1';
  const ready = searchParams.get('ready') === '1';
  const qcProcess = searchParams.get('qc_process') === '1';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const dateMode = searchParams.get('date_mode') || (dateFrom || dateTo ? 'range' : '');
  const month = searchParams.get('month') || '';
  const specFilters = useMemo(() => readSpecFilters(searchParams), [searchParams]);
  const debouncedSpecs = useDebouncedSpecParams(specFilters);

  const patchParams = useCallback((patch, { resetPage = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const apply = { ...patch };
      if (resetPage && !Object.prototype.hasOwnProperty.call(apply, 'page')) {
        apply.page = 1;
      }
      Object.entries(apply).forEach(([k, v]) => {
        if (k !== 'page' && !URL_KEYS.includes(k)) return;
        if (v === '' || v == null || v === false || (k === 'page' && Number(v) <= 1)) next.delete(k);
        else if (v === true) next.set(k, '1');
        else next.set(k, String(v));
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
    pricing_type: pricingType || undefined,
    date_mode: dateMode || undefined,
    month: dateMode === 'month' ? (month || currentMonthValue()) : undefined,
    date_from: dateMode === 'range' ? (dateFrom || undefined) : undefined,
    date_to: dateMode === 'range' ? (dateTo || undefined) : undefined,
    ...specFiltersToParams(debouncedSpecs),
  }), [search, pricingType, dateMode, month, dateFrom, dateTo, debouncedSpecs]);

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

  const loadKpis = useCallback(async () => {
    setKpiLoading(true);
    try {
      const { data } = await fetchMasterDataKpis(kpiFilterParams);
      if (!data?.success) throw new Error(data?.message || 'Failed');
      setKpis(data.kpis || {});
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load KPIs');
    } finally {
      setKpiLoading(false);
    }
  }, [kpiFilterParams]);

  const loadTab = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchMasterDataDashboard(tabFilterParams);
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
      toast.error(e.response?.data?.message || e.message || 'Failed to load master data');
    } finally {
      setLoading(false);
    }
  }, [tabFilterParams]);

  useEffect(() => { loadKpis(); }, [loadKpis]);
  useEffect(() => { loadTab(); }, [loadTab]);

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
    });
  };
  const openRentalList = () => {
    patchParams({
      pricing_type: 'rental',
      tab: 'laptops',
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
          hint="Click to open all laptops"
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
          active={location === 'Customer' && tab === 'laptops' && !fromVendor && !ready && !qcProcess && !pricingType}
        />
        <StatCard
          label="From Vendors"
          value={kpiLoading ? '…' : (kpis.total_from_vendors ?? '—')}
          icon={Building2}
          tone="purple"
          hint="Click to open laptop list"
          onClick={openFromVendorList}
          active={fromVendor && tab === 'laptops' && !ready && !qcProcess && !pricingType}
        />
        <StatCard label="Customers" value={kpiLoading ? '…' : (kpis.total_customers ?? '—')} icon={Users} />
        <StatCard label="Vendors" value={kpiLoading ? '…' : (kpis.total_vendors ?? '—')} icon={Building2} />
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
          active={pricingType === 'sale' && tab === 'laptops'}
        />
        <StatCard
          label="Total Sale Value"
          value={kpiLoading ? '…' : fmtMoney(kpis.total_sale_value)}
          icon={IndianRupee}
          tone="red"
          hint="Sum of sale prices (filtered)"
          onClick={openSaleList}
          active={pricingType === 'sale' && tab === 'laptops'}
        />
        <StatCard
          label="Rental Laptops"
          value={kpiLoading ? '…' : (kpis.total_rental_units ?? '—')}
          icon={IndianRupee}
          tone="blue"
          hint="Rental / demo deployments"
          onClick={openRentalList}
          active={pricingType === 'rental' && tab === 'laptops'}
        />
        <StatCard
          label="Monthly Rental Value"
          value={kpiLoading ? '…' : fmtMoney(kpis.total_monthly_rental_value)}
          icon={IndianRupee}
          tone="blue"
          hint="Active rental monthly total"
          onClick={openRentalList}
          active={pricingType === 'rental' && tab === 'laptops'}
        />
      </div>

      {(location === 'Customer' || fromVendor || ready || qcProcess || pricingType || dateMode) && tab === 'laptops' ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2">
          <span className="font-semibold text-teal-800">
            {dateMode === 'month'
              ? `Showing laptops for ${formatMonthLabel(month || currentMonthValue())} (delivery / rent start / GRN date, IST)`
              : dateMode === 'range' && (dateFrom || dateTo)
                ? `Showing laptops ${dateFrom || '…'} to ${dateTo || '…'} (IST activity dates)`
                : pricingType === 'sale'
                  ? 'Showing sale laptops only'
                  : pricingType === 'rental'
                    ? 'Showing rental laptops only'
                    : qcProcess
                      ? 'Showing QC process laptops (not ready to rent/sale)'
                      : ready
                        ? 'Showing ready to rent/sale laptops'
                        : location === 'Customer'
                          ? 'Showing laptops with customers'
                          : 'Showing laptops sourced from vendors'}
          </span>
          <button type="button" onClick={clearFilters} className="ml-auto text-teal-700 hover:underline font-medium">
            Clear filter
          </button>
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <SearchField
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search TTSPL, serial, customer, vendor, SO, DC, PO…"
            className="flex-1 min-w-[220px]"
          />
          <select className="border rounded-lg px-3 py-2 text-sm" value={status} onChange={(e) => patchParams({ status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select className="border rounded-lg px-3 py-2 text-sm" value={location} onChange={(e) => patchParams({ location: e.target.value })}>
            {LOCATION_OPTIONS.map((l) => (
              <option key={l || 'all'} value={l}>{l || 'All locations'}</option>
            ))}
          </select>
          <input
            className="border rounded-lg px-3 py-2 text-sm w-36"
            placeholder="Stage"
            value={stage}
            onChange={(e) => patchParams({ stage: e.target.value })}
          />
          <select className="border rounded-lg px-3 py-2 text-sm" value={pricingType} onChange={(e) => patchParams({ pricing_type: e.target.value })}>
            {PRICING_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select className="border rounded-lg px-3 py-2 text-sm" value={entity} onChange={(e) => patchParams({ entity: e.target.value })}>
            <option value="">All entities</option>
            <option value="rentfoxxy">Rentfoxxy</option>
            <option value="gorefurbo">Gorefurbo</option>
          </select>
          <select
            className="border rounded-lg px-3 py-2 text-sm min-w-[9.5rem]"
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
            <select
              className="border rounded-lg px-3 py-2 text-sm min-w-[9rem]"
              value={month || currentMonthValue()}
              onChange={(e) => patchParams({ date_mode: 'month', month: e.target.value, date_from: '', date_to: '' })}
              aria-label="Select month"
            >
              {MONTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
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

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-0">
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
                  {[
                    'TTSPL', 'Serial', 'Specs', 'Status', 'Location',
                    'Current Customer', 'Vendor', 'Vendor Type', 'Vendor Price', 'Customer Price',
                    'Stage', 'SO', 'DC', 'PO', 'GRN',
                  ].map((h) => (
                    <th
                      key={h}
                      className={`px-2 py-2 text-left whitespace-nowrap ${
                        ['Current Customer', 'Vendor', 'Vendor Type', 'Vendor Price', 'Customer Price'].includes(h)
                          ? 'bg-teal-50 text-teal-800'
                          : ''
                      }`}
                    >
                      {h}
                    </th>
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
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Vendors (filtered)" value={vendorTotals.total_vendors ?? 0} />
            <StatCard label="Purchased Laptops" value={vendorTotals.total_purchased_laptops ?? 0} />
            <StatCard label="Purchase Value" value={fmtMoney(vendorTotals.total_purchase_value)} />
          </div>
          <div className="border rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-right">Laptops</th>
                  <th className="px-3 py-2 text-right">Purchase Value</th>
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
                    <td className="px-3 py-2 text-right">{v.purchased_laptops}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(v.purchase_value)}</td>
                  </tr>
                ))}
                {!vendors.length ? (
                  <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400">No vendors</td></tr>
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
