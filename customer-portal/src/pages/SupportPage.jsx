import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import api from '../utils/api';

const STATUS = {
  NEW: 'Received',
  TRIAGED: 'Being reviewed',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  PENDING: 'Waiting',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export default function SupportPage() {
  const [tickets, setTickets] = useState([]);
  const [assets, setAssets] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    serial_id: '',
    reported_issue_id: '',
    reported_description: '',
    contact_name: '',
    contact_phone: '',
  });

  const load = () => {
    api.get('/v2/tickets').then(({ data }) => setTickets(data.tickets || [])).catch(() => setTickets([]));
    api.get('/v2/assets').then(({ data }) => setAssets(data.rows || [])).catch(() => setAssets([]));
    api.get('/v2/catalog').then(({ data }) => setCatalog(data.rows || [])).catch(() => setCatalog([]));
  };

  useEffect(() => { load(); }, []);

  const openTicket = async (id) => {
    setOpen(id);
    try {
      const { data } = await api.get(`/v2/tickets/${id}`);
      setDetail(data);
    } catch {
      toast.error('Could not load ticket');
    }
  };

  async function submit(e) {
    e.preventDefault();
    if (!form.reported_issue_id) {
      toast.error('Please classify the issue');
      return;
    }
    if (form.reported_description.trim().length < 15) {
      toast.error('Description must be at least 15 characters');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/v2/tickets', {
        contact_name: form.contact_name || undefined,
        contact_phone: form.contact_phone || undefined,
        asset_lines: [{
          serial_id: form.serial_id ? Number(form.serial_id) : undefined,
          asset_unknown: !form.serial_id,
          reported_issue_id: Number(form.reported_issue_id),
          reported_description: form.reported_description,
          impact: 2,
          urgency: 2,
        }],
      });
      toast.success(`Ticket ${data.ticket_number} created`);
      setForm((f) => ({ ...f, reported_description: '', reported_issue_id: '' }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit ticket');
    } finally {
      setBusy(false);
    }
  }

  const pendingCharge = (detail?.charges || []).find((c) => c.status === 'PENDING');

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Support</h1>

      <form onSubmit={submit} className="bg-white border rounded-xl p-6 space-y-4 max-w-2xl">
        <h2 className="font-semibold">Raise a ticket</h2>
        <label className="block text-sm">
          Machine
          <select
            value={form.serial_id}
            onChange={(e) => setForm((f) => ({ ...f, serial_id: e.target.value }))}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          >
            <option value="">I am not sure which machine</option>
            {assets.map((a) => (
              <option key={a.serial_id} value={a.serial_id}>
                {a.ttspl_id || a.serial_number} — {a.brand} {a.model}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          What is wrong *
          <select
            required
            value={form.reported_issue_id}
            onChange={(e) => setForm((f) => ({ ...f, reported_issue_id: e.target.value }))}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          >
            <option value="">— Select an issue —</option>
            {catalog.map((c) => (
              <option key={c.catalog_id} value={c.catalog_id}>
                {c.type_name} / {c.subtype_name} / {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Your name"
            value={form.contact_name}
            onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
            className="border rounded-lg px-3 py-2 text-sm"
          />
          <input
            placeholder="Mobile (10 digits)"
            value={form.contact_phone}
            onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
            className="border rounded-lg px-3 py-2 text-sm"
            maxLength={10}
          />
        </div>
        <label className="block text-sm">
          Description * (min 15 chars)
          <textarea
            required
            minLength={15}
            value={form.reported_description}
            onChange={(e) => setForm((f) => ({ ...f, reported_description: e.target.value }))}
            className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[100px]"
          />
        </label>
        <button type="submit" disabled={busy} className="px-4 py-2 bg-brand text-white rounded-lg font-semibold disabled:opacity-50">
          Submit ticket
        </button>
      </form>

      <div className="bg-white border rounded-xl overflow-hidden">
        <h2 className="font-semibold p-4 border-b">My tickets</h2>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
            <tr>
              {['Ticket', 'Subject', 'Status', 'Due', 'Created'].map((h) => <th key={h} className="p-3">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">No tickets yet</td></tr>
            ) : tickets.map((t) => (
              <React.Fragment key={t.ticket_id}>
                <tr className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => openTicket(t.ticket_id)}>
                  <td className="p-3 font-mono text-xs">{t.ticket_number}</td>
                  <td className="p-3">{t.subject || '—'}</td>
                  <td className="p-3">{t.status_label || STATUS[t.status] || t.status}</td>
                  <td className="p-3 text-xs">{t.sla_resolution_due_at ? format(new Date(t.sla_resolution_due_at), 'dd MMM HH:mm') : '—'}</td>
                  <td className="p-3 text-xs">{t.created_at ? format(new Date(t.created_at), 'dd MMM yyyy') : '—'}</td>
                </tr>
                {open === t.ticket_id && detail?.ticket?.ticket_id === t.ticket_id && (
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="p-4 space-y-3">
                      <div className="text-sm">
                        Resolution countdown only — we never show internal escalation.
                      </div>
                      {(detail.lines || []).map((l) => (
                        <div key={l.line_id} className="text-sm">
                          <span className="font-mono text-xs">{l.ttspl_id || l.serial_number || l.line_code}</span>
                          {' · '}{l.line_status} — {l.reported_description}
                        </div>
                      ))}
                      <ol className="text-sm space-y-1 list-decimal pl-5">
                        {(detail.events || []).map((ev) => (
                          <li key={ev.event_id}>{ev.summary} <span className="text-slate-400">{format(new Date(ev.created_at), 'dd MMM HH:mm')}</span></li>
                        ))}
                      </ol>
                      {pendingCharge && (
                        <div className="border rounded-lg p-3 bg-amber-50 space-y-2">
                          <div className="font-semibold">Charge awaiting your approval · ₹{Number(pendingCharge.amount).toLocaleString('en-IN')}</div>
                          <p className="text-sm">{pendingCharge.description}</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="px-3 py-1.5 bg-brand text-white rounded-lg text-sm"
                              onClick={async () => {
                                try {
                                  await api.post(`/v2/tickets/${t.ticket_id}/approve-charge`);
                                  toast.success('Charge approved');
                                  openTicket(t.ticket_id);
                                } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
                              }}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="px-3 py-1.5 border rounded-lg text-sm"
                              onClick={async () => {
                                const reason = window.prompt('Why are you disputing this charge?');
                                if (!reason) return;
                                try {
                                  await api.post(`/v2/tickets/${t.ticket_id}/dispute-charge`, { reason });
                                  toast.success('Dispute sent to Accounts');
                                  openTicket(t.ticket_id);
                                } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
                              }}
                            >
                              Dispute
                            </button>
                          </div>
                        </div>
                      )}
                      {['RESOLVED', 'CLOSED'].includes(t.status) && (
                        <button
                          type="button"
                          className="text-sm text-brand font-semibold"
                          onClick={async () => {
                            const reason = window.prompt('Why reopen this ticket?');
                            if (!reason) return;
                            try {
                              await api.post(`/v2/tickets/${t.ticket_id}/reopen`, { reason });
                              toast.success('Reopened');
                              load();
                              openTicket(t.ticket_id);
                            } catch (e) { toast.error(e.response?.data?.message || 'Cannot reopen'); }
                          }}
                        >
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
