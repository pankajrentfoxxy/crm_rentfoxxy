import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Laptop, Receipt, Clock3, Users } from 'lucide-react';
import PermissionGate from '../../../components/PermissionGate';
import { SearchField, StatCard } from '../../../components/ui/primitives';
import { listInvoiceCoverage } from '../customerBillingApi';
import InvoiceStatusBadge from './InvoiceStatusBadge';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const BUCKETS = [
  {
    key: 'assets',
    label: 'Customers with assets',
    hint: (c) => `${Number(c.laptops || 0).toLocaleString('en-IN')} rental laptop${c.laptops === 1 ? '' : 's'}`,
    tone: 'blue',
    icon: Users,
    count: (c) => c.with_assets,
  },
  {
    key: 'invoiced',
    label: 'Invoice generated',
    hint: (c) => (c.with_assets ? `${Math.round((c.invoiced / c.with_assets) * 100)}% of customers with assets` : 'No customers with assets'),
    tone: 'green',
    icon: Receipt,
    count: (c) => c.invoiced,
  },
  {
    key: 'pending',
    label: 'Pending invoice',
    hint: () => 'Has assets, no invoice this month',
    tone: 'amber',
    icon: Clock3,
    count: (c) => c.pending,
  },
];

export default function InvoiceCoveragePanel({ month, year, refreshKey = 0, onGeneratePending }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!month || !year) {
      setData(null);
      setBucket(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    listInvoiceCoverage({ month, year })
      .then((res) => {
        if (!cancelled) setData(res.data || null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [month, year, refreshKey]);

  const counts = data?.counts || { with_assets: 0, invoiced: 0, pending: 0, laptops: 0 };
  const pct = counts.with_assets ? Math.round((counts.invoiced / counts.with_assets) * 100) : 0;

  const rows = useMemo(() => {
    const list = data?.customers || [];
    const filtered = bucket === 'invoiced'
      ? list.filter((c) => c.bucket === 'invoiced')
      : bucket === 'pending'
        ? list.filter((c) => c.bucket === 'pending')
        : list;
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((c) => (
      String(c.customer_name || '').toLowerCase().includes(q)
      || String(c.invoice_number || '').toLowerCase().includes(q)
      || String(c.email || '').toLowerCase().includes(q)
    ));
  }, [data, bucket, search]);

  if (!month || !year) {
    return (
      <div className="mb-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        Select a month and year to see how many customers with assets have invoices, and who is still pending.
      </div>
    );
  }

  const title = `${MONTHS[Number(month)] || 'Month'} ${year}`;
  const pendingIds = (data?.customers || []).filter((c) => c.bucket === 'pending').map((c) => String(c.customer_id));

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing coverage</p>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500">Customers with rental assets vs invoices generated this month. Click a number for the list.</p>
        </div>
        <p className="text-sm font-semibold text-slate-700">{pct}% invoiced</p>
      </div>

      <div className="px-4">
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4">
        {BUCKETS.map((item) => (
          <StatCard
            key={item.key}
            label={item.label}
            value={loading ? '—' : Number(item.count(counts) || 0).toLocaleString('en-IN')}
            hint={loading ? 'Loading…' : item.hint(counts)}
            icon={item.icon}
            tone={item.tone}
            active={bucket === item.key}
            onClick={() => setBucket((prev) => (prev === item.key ? null : item.key))}
          />
        ))}
      </div>

      {bucket ? (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">
              {bucket === 'pending' ? 'Pending customers' : bucket === 'invoiced' ? 'Invoiced customers' : 'Customers with assets'}
              <span className="ml-2 text-slate-400 font-normal">{rows.length}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SearchField
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer or invoice…"
              />
              {bucket === 'pending' && pendingIds.length > 0 && onGeneratePending ? (
                <PermissionGate section="customer_billing" action="create">
                  <button
                    type="button"
                    onClick={() => onGeneratePending(pendingIds)}
                    className="px-3 py-2 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 min-h-[40px]"
                  >
                    Generate for pending
                  </button>
                </PermissionGate>
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-100 max-h-80 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Customer</th>
                  <th className="text-right font-medium px-3 py-2">Assets</th>
                  <th className="text-left font-medium px-3 py-2">Invoice</th>
                  <th className="text-right font-medium px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                      {loading ? 'Loading customers…' : 'No customers in this list.'}
                    </td>
                  </tr>
                ) : rows.map((c) => (
                  <tr key={c.customer_id} className="border-t border-slate-50 hover:bg-slate-50/80">
                    <td className="px-3 py-2.5">
                      <Link to={`/lead-crm/customers/${c.customer_id}`} className="font-medium text-blue-600 hover:underline">
                        {c.customer_name}
                      </Link>
                      {c.email ? <p className="text-xs text-slate-400">{c.email}</p> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <span className="inline-flex items-center justify-end gap-1 text-slate-800">
                        <Laptop className="w-3.5 h-3.5 text-slate-400" />
                        {c.asset_count}
                      </span>
                      <p className="text-[11px] text-slate-400">
                        {c.rented_count} rented{c.returned_count ? ` · ${c.returned_count} returned` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      {c.invoice_id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/customer-billing/invoices/${c.invoice_id}`} className="text-blue-600 hover:underline font-medium">
                            {c.invoice_number}
                          </Link>
                          <InvoiceStatusBadge status={c.invoice_status} />
                        </div>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-800">
                      {c.invoice_id ? fmt(c.grand_total) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
