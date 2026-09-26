import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Truck, IndianRupee, Users, FileStack, Laptop, FileSpreadsheet, FileDown, ChevronDown, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchableSelect from '../../operation-management/components/SearchableSelect';
import { PageHeader, StatCard, Button, SearchField } from '../../../components/ui/primitives';
import {
  downloadDeliveryChargesStatement,
  exportDeliveryChargesExcel,
  getDeliveryCharges,
} from '../customerBillingApi';
import api from '../../../utils/api';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEARS = Array.from({ length: 6 }, (_, i) => 2024 + i);

function fmtMoney(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

// Delivery charges for a month are sent with the next month's rental invoice,
// so the page opens on last month.
function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { month: String(d.getMonth() + 1), year: String(d.getFullYear()) };
}

async function blobErrorMessage(err, fallback) {
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).message || fallback;
    } catch {
      return fallback;
    }
  }
  return data?.message || err.message || fallback;
}

function saveBlob(res, fallbackName, type) {
  const match = String(res.headers?.['content-disposition'] || '').match(/filename="?([^"]+)"?/);
  const url = window.URL.createObjectURL(new Blob([res.data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || fallbackName;
  a.click();
  window.URL.revokeObjectURL(url);
}

export default function DeliveryChargesPage() {
  const [searchParams] = useSearchParams();
  const initial = previousMonth();
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);
  const [customerId, setCustomerId] = useState(searchParams.get('customer_id') || '');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [excelLoading, setExcelLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 320);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    api.get('/customer-management/customers/ids')
      .then((r) => setCustomers(r.data?.customers || []))
      .catch(() => setCustomers([]));
  }, []);

  const customerOptions = useMemo(
    () => customers.map((c) => ({
      value: String(c.customer_id),
      label: c.company_name || c.name || c.customer_name || `Customer #${c.customer_id}`,
    })),
    [customers]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { month, year };
      if (customerId) params.customer_id = customerId;
      if (searchDebounced) params.search = searchDebounced;
      const res = await getDeliveryCharges(params);
      setReport(res.data);
      // A single customer is shown opened up.
      const list = res.data?.customers || [];
      setExpanded(new Set(list.length === 1 ? [list[0].customer_id ?? list[0].customer_name] : []));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load delivery charges');
    } finally {
      setLoading(false);
    }
  }, [month, year, customerId, searchDebounced]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleExcel = async (forCustomerId) => {
    setExcelLoading(true);
    try {
      const params = { month, year };
      const cid = forCustomerId || customerId;
      if (cid) params.customer_id = cid;
      if (!forCustomerId && searchDebounced) params.search = searchDebounced;
      const res = await exportDeliveryChargesExcel(params);
      saveBlob(res, `delivery_charges_${MONTHS[Number(month)]}_${year}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      toast.success('Excel downloaded');
    } catch (err) {
      toast.error(await blobErrorMessage(err, 'Excel export failed'));
    } finally {
      setExcelLoading(false);
    }
  };

  const handlePdf = async (c) => {
    if (!c.customer_id) {
      toast.error('This DC has no linked customer record');
      return;
    }
    setPdfLoading(c.customer_id);
    try {
      const res = await downloadDeliveryChargesStatement({ month, year, customer_id: c.customer_id });
      saveBlob(res, `Delivery-Charges-${c.customer_name}-${MONTHS[Number(month)]}-${year}.pdf`, 'application/pdf');
    } catch (err) {
      toast.error(await blobErrorMessage(err, 'PDF download failed'));
    } finally {
      setPdfLoading(null);
    }
  };

  const summary = report?.summary || {};
  const list = report?.customers || [];
  const trend = report?.trend || [];
  const periodLabel = `${MONTHS[Number(month)]} ${year}`;
  const nextLabel = MONTHS[(Number(month) % 12) + 1];

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Delivery Charges"
        subtitle={`Shipping charges to collect, billed separately from the rental invoice · send ${periodLabel} with the ${nextLabel} invoice`}
        icon={Truck}
        actions={(
          <Button variant="secondary" icon={FileSpreadsheet} onClick={() => handleExcel()} loading={excelLoading}>
            Export Excel
          </Button>
        )}
      />

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Month
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] min-w-[110px]">
            {MONTHS.slice(1).map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Year
          <select value={year} onChange={(e) => setYear(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] min-w-[100px]">
            {YEARS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </label>
        <div className="min-w-[220px] w-60">
          <SearchableSelect
            id="delivery-charges-customer"
            value={customerId}
            onChange={setCustomerId}
            options={customerOptions}
            placeholder="All customers"
          />
        </div>
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search customer, DC, SO, address…"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label={`To collect · ${periodLabel}`} value={fmtMoney(summary.total)} icon={IndianRupee} tone="green" />
        <StatCard label="Customers" value={summary.customer_count || 0} icon={Users} tone="blue" />
        <StatCard label="Deliveries (DCs)" value={summary.dc_count || 0} icon={FileStack} tone="purple" />
        <StatCard label="Laptops delivered" value={summary.laptop_qty || 0} icon={Laptop} tone="teal" />
      </div>

      {trend.length > 0 && (
        <div className="mb-4 bg-white border border-slate-200 rounded-2xl p-3 overflow-x-auto">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 px-1">Last 12 months · click a month to open it</p>
          <div className="flex gap-2 min-w-max">
            {trend.map((t) => {
              const active = String(t.month) === month && String(t.year) === year;
              return (
                <button
                  key={`${t.year}-${t.month}`}
                  type="button"
                  onClick={() => { setMonth(String(t.month)); setYear(String(t.year)); }}
                  className={`rounded-xl border px-3 py-2 text-left min-w-[108px] transition-colors ${
                    active ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs text-slate-500">{t.label}</p>
                  <p className={`text-sm font-semibold ${t.total ? 'text-slate-900' : 'text-slate-300'}`}>{fmtMoney(t.total)}</p>
                  <p className="text-[11px] text-slate-400">{t.customer_count} cust · {t.dc_count} DC</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-3 w-8" />
              <th className="px-3 py-3 text-left">Customer</th>
              <th className="px-3 py-3 text-right">DCs</th>
              <th className="px-3 py-3 text-right">Laptops</th>
              <th className="px-3 py-3 text-right">Delivery Charges</th>
              <th className="px-3 py-3 text-left">Download</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No delivery charges for {periodLabel}.</td></tr>
            ) : list.map((c) => {
              const key = c.customer_id ?? c.customer_name;
              const open = expanded.has(key);
              return (
                <Fragment key={key}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50/70 cursor-pointer" onClick={() => toggle(key)}>
                    <td className="px-3 py-3 text-slate-400">
                      {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </td>
                    <td className="px-3 py-3">
                      {c.customer_id ? (
                        <Link to={`/lead-crm/customers/${c.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-blue-600 hover:underline">
                          {c.customer_name}
                        </Link>
                      ) : <span className="font-medium">{c.customer_name}</span>}
                      {c.gst_number && <p className="text-[11px] text-slate-400">GSTIN {c.gst_number}</p>}
                    </td>
                    <td className="px-3 py-3 text-right">{c.dc_count}</td>
                    <td className="px-3 py-3 text-right">{c.laptop_qty}</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">{fmtMoney(c.total)}</td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => handlePdf(c)}
                          disabled={pdfLoading === c.customer_id}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          {pdfLoading === c.customer_id ? 'Preparing…' : 'PDF'}
                        </button>
                        {c.customer_id && (
                          <button
                            type="button"
                            onClick={() => handleExcel(c.customer_id)}
                            disabled={excelLoading}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-50/60">
                      <td />
                      <td colSpan={5} className="px-3 pb-3">
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                          <table className="w-full text-xs">
                            <thead className="text-slate-500 uppercase tracking-wide bg-slate-50">
                              <tr>
                                <th className="px-3 py-2 text-left">DC</th>
                                <th className="px-3 py-2 text-left">Dispatched</th>
                                <th className="px-3 py-2 text-left">Delivery contact</th>
                                <th className="px-3 py-2 text-left">Delivery address</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                                <th className="px-3 py-2 text-left">Status</th>
                                <th className="px-3 py-2 text-right">Charge</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.dcs.map((d) => (
                                <tr key={d.dc_number} className="border-t border-slate-100 align-top">
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    <span className="font-medium text-slate-800">{d.dc_number}</span>
                                    {d.sales_order_number && <p className="text-[11px] text-slate-400">{d.sales_order_number}</p>}
                                    {d.movement_type === 'return' && <p className="text-[11px] font-medium text-amber-600">{d.kind}</p>}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(d.dispatched_at)}</td>
                                  <td className="px-3 py-2">{d.delivery_contact || '—'}</td>
                                  <td className="px-3 py-2 min-w-[260px] text-slate-600">{d.delivery_address || '—'}</td>
                                  <td className="px-3 py-2 text-right">{d.laptop_qty}</td>
                                  <td className="px-3 py-2 capitalize">{String(d.status || '—').replace(/_/g, ' ')}</td>
                                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{fmtMoney(d.delivery_charge)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {!loading && list.length > 0 && (
            <tfoot className="bg-emerald-50/70 font-semibold text-slate-800">
              <tr>
                <td />
                <td className="px-3 py-3">Total · {summary.customer_count} customer{summary.customer_count === 1 ? '' : 's'}</td>
                <td className="px-3 py-3 text-right">{summary.dc_count}</td>
                <td className="px-3 py-3 text-right">{summary.laptop_qty}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap">{fmtMoney(summary.total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-slate-400 mt-2">
        A DC counts in the month it was dispatched. Rejected and cancelled DCs are left out.
      </p>
    </div>
  );
}
