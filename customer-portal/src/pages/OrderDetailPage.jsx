import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../utils/api';
import StatusBadge from '../components/StatusBadge';
import { fmtDate, inr } from '../utils/format';

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 mt-0.5">{children ?? '—'}</dd>
    </div>
  );
}

function addressText(address) {
  if (!address) return null;
  if (typeof address === 'string') return address;
  return [address.address, address.city, address.state, address.pincode]
    .filter(Boolean)
    .join(', ');
}

export default function OrderDetailPage() {
  const { soNumber } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/orders/${encodeURIComponent(soNumber)}`)
      .then(({ data }) => { setOrder(data.order); setError(null); })
      .catch((err) => setError(err.response?.data?.message || 'Could not load this order'))
      .finally(() => setLoading(false));
  }, [soNumber]);

  if (loading) return <p className="text-slate-500 animate-pulse">Loading order…</p>;
  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/orders" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to orders
        </Link>
        <p className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</p>
      </div>
    );
  }
  if (!order) return null;

  return (
    <div className="space-y-6">
      <Link to="/orders" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to orders
      </Link>

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold font-mono">{order.sales_order_number}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {order.order_type} · Placed {fmtDate(order.order_date)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={order.order_status} />
            <StatusBadge status={order.payment_status} />
          </div>
        </div>

        <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-100">
          <Field label="Quantity">{order.quantity}</Field>
          <Field label="Order Value">{inr(order.total_value)}</Field>
          <Field label="Amount Paid">
            {order.payment_status === 'monthly_invoicing'
              ? <Link to="/invoices" className="text-brand hover:underline">Billed monthly — see invoices</Link>
              : inr(order.amount_paid)}
          </Field>
          <Field label="Quotation">{order.quotation_number}</Field>
        </dl>

        {addressText(order.shipping_address) && (
          <div className="pt-2 border-t border-slate-100">
            <Field label="Delivery Address">
              {addressText(order.shipping_address)}
              {order.is_wfh && <span className="ml-2 text-xs text-slate-500">(Work from home)</span>}
            </Field>
          </div>
        )}
      </div>

      <section className="bg-white border rounded-xl overflow-hidden">
        <h2 className="font-semibold p-4 border-b">Ordered Configuration</h2>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
            <tr>
              {['Laptop', 'Configuration', 'Qty', 'Rate', 'Warranty', 'Status'].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{[l.brand, l.model_name].filter(Boolean).join(' ') || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{l.config || '—'}</td>
                <td className="px-4 py-3">{l.quantity}</td>
                <td className="px-4 py-3">{inr(l.rate)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {l.technical_warranty ? `${l.technical_warranty} mo technical` : '—'}
                  {l.battery_charger_warranty ? ` · ${l.battery_charger_warranty} mo battery` : ''}
                </td>
                <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {order.serials.length > 0 && (
        <section className="bg-white border rounded-xl overflow-hidden">
          <h2 className="font-semibold p-4 border-b">Allocated Laptops</h2>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
              <tr>
                {['TTSPL ID', 'Serial Number', 'Laptop', 'Configuration', 'DC Number'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.serials.map((s) => (
                <tr key={`${s.ttspl_id}-${s.serial_number}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs">{s.ttspl_id || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.serial_number || '—'}</td>
                  <td className="px-4 py-3">{[s.brand, s.model_name].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.config || '—'}</td>
                  <td className="px-4 py-3">
                    {s.dc_number ? (
                      <Link to={`/deliveries/${encodeURIComponent(s.dc_number)}`} className="font-mono text-xs text-brand hover:underline">
                        {s.dc_number}
                      </Link>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="bg-white border rounded-xl overflow-hidden">
        <h2 className="font-semibold p-4 border-b">Delivery Challans</h2>
        {order.delivery_challans.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 text-center">
            No delivery challan has been raised for this order yet.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
              <tr>
                {['DC Number', 'Status', 'Mode', 'Tracking', 'Dispatched', 'Delivered', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.delivery_challans.map((dc) => (
                <tr key={dc.dc_number} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link to={`/deliveries/${encodeURIComponent(dc.dc_number)}`} className="font-mono text-xs text-brand hover:underline">
                      {dc.dc_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={dc.status} /></td>
                  <td className="px-4 py-3 text-slate-600 capitalize">{dc.dispatch_mode || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {dc.courier_name || '—'}
                    {dc.awb_number && <span className="block font-mono">{dc.awb_number}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">{fmtDate(dc.dispatched_at)}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(dc.delivered_at)}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/deliveries/${encodeURIComponent(dc.dc_number)}`}
                      className="text-xs px-2.5 py-1 border rounded-lg hover:bg-slate-50 whitespace-nowrap"
                    >
                      Track
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {order.payments.length > 0 && (
        <section className="bg-white border rounded-xl overflow-hidden">
          <h2 className="font-semibold p-4 border-b">Payments</h2>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
              <tr>
                {['Date', 'Type', 'Mode', 'Reference', 'Amount'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.payments.map((p, i) => (
                <tr key={`${p.payment_date}-${i}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-xs">{fmtDate(p.payment_date)}</td>
                  <td className="px-4 py-3 capitalize">{p.payment_type || '—'}</td>
                  <td className="px-4 py-3 capitalize text-slate-600">{p.payment_mode || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.reference_number || '—'}</td>
                  <td className="px-4 py-3 font-medium">{inr(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
