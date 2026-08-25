import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ExternalLink } from 'lucide-react';
import api from '../utils/api';
import StatusBadge from '../components/StatusBadge';
import { fmtDate, fmtDateTime } from '../utils/format';

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 mt-0.5">{children ?? '—'}</dd>
    </div>
  );
}

function Timeline({ steps }) {
  return (
    <ol className="space-y-3">
      {steps.map((step) => {
        const done = Boolean(step.at);
        return (
          <li key={step.key} className="flex items-start gap-3">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                done ? 'bg-brand text-white' : 'bg-slate-100 text-slate-300'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
            </span>
            <div>
              <p className={`text-sm ${done ? 'font-medium text-slate-900' : 'text-slate-400'}`}>
                {step.label}
              </p>
              <p className="text-xs text-slate-500">{done ? fmtDateTime(step.at) : 'Pending'}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function DeliveryDetailPage() {
  const { dcNumber } = useParams();
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/deliveries/${encodeURIComponent(dcNumber)}`)
      .then(({ data }) => { setDelivery(data.delivery); setError(null); })
      .catch((err) => setError(err.response?.data?.message || 'Could not load this delivery'))
      .finally(() => setLoading(false));
  }, [dcNumber]);

  if (loading) return <p className="text-slate-500 animate-pulse">Loading delivery…</p>;
  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/deliveries" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to deliveries
        </Link>
        <p className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</p>
      </div>
    );
  }
  if (!delivery) return null;

  return (
    <div className="space-y-6">
      <Link to="/deliveries" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to deliveries
      </Link>

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold font-mono">{delivery.dc_number}</h1>
            {delivery.sales_order_number && (
              <p className="text-sm text-slate-500 mt-1">
                Order{' '}
                <Link
                  to={`/orders/${encodeURIComponent(delivery.sales_order_number)}`}
                  className="font-mono text-brand hover:underline"
                >
                  {delivery.sales_order_number}
                </Link>
              </p>
            )}
          </div>
          <StatusBadge status={delivery.status} />
        </div>

        <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-100">
          <Field label="Dispatch Mode"><span className="capitalize">{delivery.dispatch_mode || '—'}</span></Field>
          <Field label="Courier">{delivery.courier_name || '—'}</Field>
          <Field label="AWB / Tracking">
            <span className="font-mono text-xs">{delivery.awb_number || '—'}</span>
          </Field>
          <Field label="Expected Delivery">{fmtDate(delivery.estimated_delivery)}</Field>
        </dl>

        {(delivery.courier_tracking_url || delivery.porter_tracking_id) && (
          <div className="pt-4 border-t border-slate-100 flex flex-wrap gap-2">
            {delivery.courier_tracking_url && (
              <a
                href={delivery.courier_tracking_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-slate-50"
              >
                Track with courier <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {delivery.porter_tracking_id && (
              <span className="px-3 py-1.5 text-sm border rounded-lg text-slate-600">
                Porter ref: <span className="font-mono">{delivery.porter_tracking_id}</span>
              </span>
            )}
          </div>
        )}

        {delivery.rejection_reason && (
          <div className="pt-4 border-t border-slate-100">
            <Field label="Refusal Reason">
              <span className="text-red-700">{delivery.rejection_reason}</span>
            </Field>
          </div>
        )}

        {delivery.delivery_notes && (
          <div className="pt-4 border-t border-slate-100">
            <Field label="Delivery Notes">{delivery.delivery_notes}</Field>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-white border rounded-xl p-6">
          <h2 className="font-semibold mb-4">Tracking</h2>
          <Timeline steps={delivery.timeline || []} />
        </section>

        <section className="bg-white border rounded-xl p-6">
          <h2 className="font-semibold mb-4">Proof of Delivery</h2>
          {delivery.pod_submitted_at ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Received {fmtDateTime(delivery.pod_submitted_at)}
                {delivery.pod_type ? ` · ${delivery.pod_type}` : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {delivery.pod_photo_url && (
                  <a
                    href={delivery.pod_photo_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-slate-50"
                  >
                    View photo <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {delivery.esign_url && (
                  <a
                    href={delivery.esign_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-slate-50"
                  >
                    View signature <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Proof of delivery will appear here once the laptops are handed over.
            </p>
          )}
        </section>
      </div>

      <section className="bg-white border rounded-xl overflow-hidden">
        <h2 className="font-semibold p-4 border-b">Laptops on this challan</h2>
        {delivery.units.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 text-center">
            Laptop details will appear once the challan is allocated.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
              <tr>
                {['TTSPL ID', 'Serial Number', 'Laptop', 'Configuration'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {delivery.units.map((u) => (
                <tr key={`${u.ttspl_id}-${u.serial_number}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs">{u.ttspl_id || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{u.serial_number || '—'}</td>
                  <td className="px-4 py-3">{[u.brand, u.model_name].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.config || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
