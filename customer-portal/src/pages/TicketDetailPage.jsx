import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import api from '../utils/api';
import StatusBadge from '../components/StatusBadge';
import { fmtDate, fmtDateTime } from '../utils/format';

/**
 * The customer-facing journey. This deliberately mirrors only the stages the API
 * exposes — internal technician, QC and warehouse steps are never surfaced.
 */
const JOURNEY = [
  { key: 'received', label: 'Received' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'picked_up', label: 'Device Picked Up' },
  { key: 'at_service_centre', label: 'At Service Centre' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'resolved', label: 'Resolved' },
];

const REPLACEMENT_JOURNEY = [
  { key: 'received', label: 'Received' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'replacement_in_progress', label: 'Replacement In Progress' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'resolved', label: 'Resolved' },
];

const ITEM_TYPE = { complaint: 'Technician visit', pickup: 'Pickup', replacement: 'Replacement' };

function Progress({ stage, ticketType }) {
  const steps = ticketType === 'replacement' ? REPLACEMENT_JOURNEY : JOURNEY;
  if (stage === 'cancelled') {
    return <p className="text-sm text-slate-500">This ticket was cancelled.</p>;
  }
  const effective = stage === 'closed' ? 'resolved' : stage;
  const currentIdx = steps.findIndex((s) => s.key === effective);

  return (
    <ol className="flex flex-wrap gap-y-3">
      {steps.map((step, i) => {
        const done = currentIdx >= 0 && i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={step.key} className="flex items-center gap-2 pr-3">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                done ? 'bg-brand text-white'
                  : active ? 'bg-brand/15 text-brand border-2 border-brand'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </span>
            <span className={`text-xs ${active ? 'font-semibold text-slate-900' : done ? 'text-slate-600' : 'text-slate-400'}`}>
              {step.label}
            </span>
            {i < steps.length - 1 && <span className="w-6 h-px bg-slate-200 hidden sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 mt-0.5">{children ?? '—'}</dd>
    </div>
  );
}

export default function TicketDetailPage() {
  const { ticketId } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/tickets/${ticketId}`)
      .then(({ data }) => { setTicket(data.ticket); setError(null); })
      .catch((err) => setError(err.response?.data?.message || 'Could not load this ticket'))
      .finally(() => setLoading(false));
  }, [ticketId]);

  if (loading) return <p className="text-slate-500 animate-pulse">Loading ticket…</p>;
  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/support/tickets" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to tickets
        </Link>
        <p className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</p>
      </div>
    );
  }
  if (!ticket) return null;

  const addr = ticket.pickup_address;
  const cancelled = String(ticket.status || '').toLowerCase() === 'cancelled';

  return (
    <div className="space-y-6">
      <Link to="/support/tickets" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to tickets
      </Link>

      <div className="bg-white border rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold font-mono">{ticket.ticket_number}</h1>
            <p className="text-sm text-slate-500 mt-1 capitalize">
              {ticket.ticket_type} · Raised {fmtDate(ticket.created_at)}
            </p>
          </div>
          <StatusBadge
            status={cancelled ? 'cancelled' : ticket.stage}
            label={cancelled ? 'Cancelled' : ticket.stage_label}
          />
        </div>

        <div className="pt-4 border-t border-slate-100">
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-3">Progress</p>
          <Progress stage={ticket.stage} ticketType={ticket.ticket_type} />
        </div>

        <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-100">
          <Field label="TTSPL ID"><span className="font-mono text-xs">{ticket.ttspl_id || '—'}</span></Field>
          <Field label="Subject">{ticket.subject}</Field>
          <Field label="Last Updated">{fmtDateTime(ticket.last_updated)}</Field>
          <Field label="Closed On">{ticket.closed_at ? fmtDate(ticket.closed_at) : '—'}</Field>
        </dl>

        {ticket.description && ticket.description !== ticket.subject && (
          <div className="pt-4 border-t border-slate-100">
            <Field label="What you reported">
              <p className="whitespace-pre-wrap text-slate-700">{ticket.description}</p>
            </Field>
          </div>
        )}

        {addr && (addr.address || addr.city) && (
          <div className="pt-4 border-t border-slate-100">
            <Field label="Pickup Address">
              {[addr.name, addr.address, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ')}
              {addr.phone && <span className="block text-xs text-slate-500">{addr.phone}</span>}
            </Field>
          </div>
        )}
      </div>

      {/* One card per laptop: where it is, how the visit ended, and the updates
          our support team shared with you (16 Oct 2026). */}
      <section className="space-y-3">
        <h2 className="font-semibold">Laptops on this ticket</h2>
        {ticket.items.length === 0 ? (
          <p className="bg-white border rounded-xl p-6 text-sm text-slate-500 text-center">No laptop was attached to this ticket.</p>
        ) : ticket.items.map((it) => (
          <article key={it.item_id} className="bg-white border rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold">{it.ttspl_id || it.serial_number || '—'}</p>
                <p className="text-sm text-slate-600">{[it.brand, it.model].filter(Boolean).join(' ') || 'Laptop'}</p>
                {it.config && <p className="text-xs text-slate-500 mt-0.5">{it.config}</p>}
              </div>
              <div className="text-right">
                <StatusBadge status={it.stage} label={it.stage_label} />
                <p className="text-xs text-slate-500 mt-1 capitalize">{ITEM_TYPE[it.item_type] || it.item_type}</p>
              </div>
            </div>
            {it.result && (
              <p className="text-sm rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2">
                {it.result}{it.closed_at ? ` · ${fmtDate(it.closed_at)}` : ''}
              </p>
            )}
            {(it.updates || []).length > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Updates from our team</p>
                <ol className="space-y-2">
                  {it.updates.map((u, n) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <li key={n} className="flex gap-3 text-sm">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-brand shrink-0" aria-hidden="true" />
                      <div>
                        <p className="text-slate-800 whitespace-pre-wrap">{u.text}</p>
                        <p className="text-xs text-slate-400">{fmtDateTime(u.at)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
