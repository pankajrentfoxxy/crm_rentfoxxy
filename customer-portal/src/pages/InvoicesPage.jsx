import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { downloadInvoicePdf } from '../utils/api';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TABS = ['all', 'draft', 'sent', 'paid'];

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function statusBadge(s) {
  const map = { draft: 'bg-slate-100', sent: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700' };
  return map[s] || 'bg-slate-100';
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = tab === 'all' ? {} : { status: tab };
    api.get('/invoices', { params }).then(({ data }) => setInvoices(data.invoices || [])).finally(() => setLoading(false));
  }, [tab]);

  const summary = useMemo(() => {
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const paid = invoices.filter((i) => i.status === 'paid' && new Date(i.paid_at || i.sent_at) >= yearAgo);
    const outstanding = invoices.filter((i) => i.status === 'sent');
    return {
      totalPaid: paid.reduce((s, i) => s + Number(i.grand_total || 0), 0),
      outstanding: outstanding.reduce((s, i) => s + Number(i.grand_total || 0), 0),
    };
  }, [invoices]);

  async function handleDownload(inv) {
    try {
      await downloadInvoicePdf(inv.invoice_id, `${inv.invoice_number || 'invoice'}.pdf`);
    } catch (err) {
      toast.error(err.message || 'Failed to download invoice PDF');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">My Invoices</h1>
      <div className="grid sm:grid-cols-3 gap-4 text-sm">
        <div className="bg-white border rounded-lg p-4"><p className="text-slate-500">Total Paid (12 mo)</p><p className="font-bold text-lg">{inr(summary.totalPaid)}</p></div>
        <div className="bg-white border rounded-lg p-4"><p className="text-slate-500">Outstanding</p><p className="font-bold text-lg">{inr(summary.outstanding)}</p></div>
        <div className="bg-white border rounded-lg p-4"><p className="text-slate-500">Next Invoice</p><p className="font-bold text-lg">1st of next month</p></div>
      </div>
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize ${tab === t ? 'bg-brand text-white' : 'bg-white border'}`}>
            {t}
          </button>
        ))}
      </div>
      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {loading ? (
          <p className="p-8 text-center text-slate-500">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="p-8 text-center text-slate-500">No invoices</p>
        ) : invoices.map((inv) => (
          <div key={inv.invoice_id} className={`bg-white border rounded-2xl p-4 shadow-sm space-y-2 ${inv.status === 'sent' ? 'border-red-200' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{inv.invoice_number}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${statusBadge(inv.status)}`}>
                {inv.status}{inv.status === 'sent' && ' · overdue'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{MONTHS[inv.invoice_month]} {inv.invoice_year}</span>
              <span>{inv.from_date} – {inv.to_date}</span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <span className="text-base font-bold text-slate-900">{inr(inv.grand_total)}</span>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => handleDownload(inv)} className="text-brand text-sm font-semibold">PDF</button>
                <Link to={`/invoices/${inv.invoice_id}`} className="text-brand text-sm font-semibold">View</Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block bg-white rounded-xl border overflow-x-auto">
        {loading ? <p className="p-8 text-center text-slate-500">Loading…</p> : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
              <tr>
                {['Invoice #', 'Month', 'Period', 'Total', 'Status', 'Actions'].map((h) => <th key={h} className="p-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.invoice_id} className={`border-t ${inv.status === 'sent' ? 'bg-red-50/30' : ''}`}>
                  <td className="p-3 font-medium">{inv.invoice_number}</td>
                  <td className="p-3">{MONTHS[inv.invoice_month]} {inv.invoice_year}</td>
                  <td className="p-3 text-xs">{inv.from_date} – {inv.to_date}</td>
                  <td className="p-3">{inr(inv.grand_total)}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${statusBadge(inv.status)}`}>{inv.status}</span>
                    {inv.status === 'sent' && <span className="ml-1 text-[10px] text-red-600 font-bold">OVERDUE</span>}
                  </td>
                  <td className="p-3 space-x-2">
                    <button type="button" onClick={() => handleDownload(inv)} className="text-brand text-xs font-semibold">Download PDF</button>
                    <Link to={`/invoices/${inv.invoice_id}`} className="text-brand text-xs font-semibold">View Details</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
