import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Boxes, Clock, Headphones, PackageOpen, Repeat, Truck, PackageCheck, Laptop,
} from 'lucide-react';
import api, { downloadInvoicePdf } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { inr, fmtDate } from '../utils/format';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Each card links to the list that explains its number, with the matching
 * filter already applied, so the count and the list can never disagree.
 */
const KPI_CARDS = [
  {
    key: 'active_orders',
    label: 'Active Orders',
    hint: 'Not yet fully delivered',
    to: '/orders?order_status=active',
    icon: Boxes,
    tone: 'text-brand bg-teal-50',
  },
  {
    key: 'pending_orders',
    label: 'Pending Orders',
    hint: 'Awaiting dispatch',
    to: '/orders?order_status=pending',
    icon: Clock,
    tone: 'text-amber-600 bg-amber-50',
  },
  {
    key: 'open_support_tickets',
    label: 'Open Support Tickets',
    hint: 'Being worked on',
    to: '/support/tickets?status=open',
    icon: Headphones,
    tone: 'text-blue-600 bg-blue-50',
  },
  {
    key: 'pending_pickup',
    label: 'Pending Pickup',
    hint: 'Collection in progress',
    to: '/support/tickets?ticket_type=pickup',
    icon: PackageOpen,
    tone: 'text-purple-600 bg-purple-50',
  },
  {
    key: 'pending_replacement',
    label: 'Pending Replacement',
    hint: 'Swap in progress',
    to: '/support/tickets?ticket_type=replacement',
    icon: Repeat,
    tone: 'text-purple-600 bg-purple-50',
  },
  {
    key: 'in_transit_deliveries',
    label: 'In-Transit Deliveries',
    hint: 'On the way to you',
    to: '/deliveries?status=in_transit',
    icon: Truck,
    tone: 'text-blue-600 bg-blue-50',
  },
  {
    key: 'delivered_laptops',
    label: 'Delivered Laptops',
    hint: 'Delivered to date',
    to: '/deliveries?status=delivered',
    icon: PackageCheck,
    tone: 'text-green-600 bg-green-50',
  },
  {
    key: 'active_laptops',
    label: 'Active Laptops',
    hint: 'Currently with you',
    to: '/laptops',
    icon: Laptop,
    tone: 'text-green-600 bg-green-50',
  },
];

export default function DashboardPage() {
  const { customer, readOnly } = useAuth();
  const [kpis, setKpis] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get('/dashboard'),
      api.get('/invoices'),
      api.get('/tickets', { params: { limit: 5 } }),
      api.get('/deliveries', { params: { limit: 5 } }),
    ])
      .then(([dash, inv, tix, del]) => {
        if (dash.status === 'fulfilled') setKpis(dash.value.data?.kpis || null);
        if (inv.status === 'fulfilled') setInvoices(inv.value.data?.invoices || []);
        if (tix.status === 'fulfilled') setTickets(tix.value.data?.tickets || []);
        if (del.status === 'fulfilled') setDeliveries(del.value.data?.deliveries || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const currentInvoice = useMemo(
    () => invoices.find((i) => i.invoice_month === now.getMonth() + 1 && i.invoice_year === now.getFullYear()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices]
  );

  const activity = useMemo(() => {
    const items = [
      ...deliveries.slice(0, 3).map((d) => ({
        icon: '💻',
        text: `Delivery ${d.dc_number} — ${d.status}`,
        to: `/deliveries/${encodeURIComponent(d.dc_number)}`,
        date: d.dispatched_at || d.delivered_at || d.created_at,
      })),
      ...tickets.slice(0, 3).map((t) => ({
        icon: '🔧',
        text: `Support ticket ${t.ticket_number} — ${t.stage_label || t.status}`,
        to: `/support/tickets/${t.ticket_id}`,
        date: t.created_at,
      })),
    ];
    return items.filter((a) => a.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  }, [deliveries, tickets]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Welcome back, {customer?.company_name || customer?.name}
        </h1>
        <p className="text-sm text-slate-500 mt-1">Your orders, laptops and support at a glance</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.key}
              to={card.to}
              className="bg-white rounded-xl border p-5 shadow-sm hover:border-brand hover:shadow transition group"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{card.label}</p>
                <span className={`p-1.5 rounded-lg ${card.tone}`}>
                  <Icon className="w-4 h-4" />
                </span>
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-2">
                {loading ? <span className="inline-block w-10 h-7 bg-slate-100 rounded animate-pulse" /> : (kpis?.[card.key] ?? 0)}
              </p>
              <p className="text-xs text-slate-400 mt-1 group-hover:text-brand">{card.hint}</p>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        {!readOnly && (
          <Link to="/support/new" className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold">
            Create Support Ticket
          </Link>
        )}
        <Link to="/orders" className="px-4 py-2 rounded-lg border text-sm font-semibold">View Orders</Link>
        <Link to="/invoices" className="px-4 py-2 rounded-lg border text-sm font-semibold">View Invoices</Link>
      </div>

      {currentInvoice && ['sent', 'draft'].includes(currentInvoice.status) && (
        <div className="bg-white rounded-xl border p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-semibold">
              {MONTHS[currentInvoice.invoice_month]} {currentInvoice.invoice_year} Invoice
            </p>
            <p className="text-sm text-slate-500">
              {inr(currentInvoice.grand_total)} · {currentInvoice.status}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => downloadInvoicePdf(currentInvoice.invoice_id, `${currentInvoice.invoice_number}.pdf`)}
              className="px-3 py-1.5 text-sm border rounded-lg"
            >
              Download PDF
            </button>
            <Link to={`/invoices/${currentInvoice.invoice_id}`} className="px-3 py-1.5 text-sm bg-brand text-white rounded-lg">
              View Details
            </Link>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3">Recent Activity</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">No recent activity</p>
        ) : (
          <ul className="space-y-2">
            {activity.map((a) => (
              <li key={a.text} className="text-sm flex justify-between gap-4 border-b border-slate-50 pb-2">
                <Link to={a.to} className="hover:text-brand hover:underline">
                  {a.icon} {a.text}
                </Link>
                <span className="text-slate-400 shrink-0">{fmtDate(a.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
