import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import api, { downloadInvoicePdf } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

export default function DashboardPage() {
  const { customer } = useAuth();
  const [laptops, setLaptops] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/laptops'),
      api.get('/invoices'),
      api.get('/tickets'),
      api.get('/deliveries'),
    ])
      .then(([lap, inv, tix, del]) => {
        setLaptops(lap.data?.laptops || []);
        setInvoices(inv.data?.invoices || []);
        setTickets(tix.data?.tickets || []);
        setDeliveries(del.data?.deliveries || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const currentInvoice = useMemo(
    () => invoices.find((i) => i.invoice_month === now.getMonth() + 1 && i.invoice_year === now.getFullYear()),
    [invoices, now]
  );
  const openTickets = tickets.filter((t) => t.status !== 'closed' && t.status !== 'cancelled').length;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const activity = useMemo(() => {
    const items = [
      ...deliveries.slice(0, 3).map((d) => ({
        icon: '💻',
        text: `Delivery ${d.dc_number} — ${d.status}`,
        date: d.dispatch_date || d.delivered_at,
      })),
      ...tickets.slice(0, 3).map((t) => ({
        icon: '🔧',
        text: `Support ticket #T-${t.ticket_id} — ${t.status}`,
        date: t.created_at,
      })),
    ];
    return items.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  }, [deliveries, tickets]);

  if (loading) return <p className="text-slate-500 animate-pulse">Loading dashboard…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Welcome back, {customer?.company_name || customer?.name}</h1>
        <p className="text-sm text-slate-500 mt-1">Your rental overview</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Rentals', value: laptops.length },
          { label: 'Current Month Bill', value: inr(currentInvoice?.grand_total || 0) },
          { label: 'Next Invoice Date', value: `1st ${format(nextMonth, 'MMM yyyy')}` },
          { label: 'Open Support Tickets', value: openTickets },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{c.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-2">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/invoices" className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold">View Invoices</Link>
        <Link to="/support" className="px-4 py-2 rounded-lg border text-sm font-semibold">Raise Support Ticket</Link>
        <Link to="/laptops" className="px-4 py-2 rounded-lg border text-sm font-semibold">View Laptops</Link>
      </div>

      {currentInvoice && ['sent', 'draft'].includes(currentInvoice.status) && (
        <div className="bg-white rounded-xl border p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-semibold">{MONTHS[currentInvoice.invoice_month]} {currentInvoice.invoice_year} Invoice</p>
            <p className="text-sm text-slate-500">{inr(currentInvoice.grand_total)} · {currentInvoice.status}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => downloadInvoicePdf(currentInvoice.invoice_id, `${currentInvoice.invoice_number}.pdf`)}
              className="px-3 py-1.5 text-sm border rounded-lg">Download PDF</button>
            <Link to={`/invoices/${currentInvoice.invoice_id}`} className="px-3 py-1.5 text-sm bg-brand text-white rounded-lg">View Details</Link>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3">Recent Activity</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">No recent activity</p>
        ) : (
          <ul className="space-y-2">
            {activity.map((a, i) => (
              <li key={i} className="text-sm flex justify-between gap-4 border-b border-slate-50 pb-2">
                <span>{a.icon} {a.text}</span>
                <span className="text-slate-400 shrink-0">{a.date ? format(new Date(a.date), 'dd MMM yyyy') : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
