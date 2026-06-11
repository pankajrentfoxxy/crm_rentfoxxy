import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import api from '../utils/api';

const ISSUE_TYPES = [
  'Laptop Not Working', 'Display Issue', 'Keyboard Issue', 'Battery Issue',
  'Software Issue', 'Replacement Request', 'Return Request', 'Other',
];

function ticketStatusClass(s) {
  const map = {
    open: 'bg-blue-100 text-blue-700',
    progress: 'bg-amber-100 text-amber-700',
    replacement: 'bg-purple-100 text-purple-700',
    closed: 'bg-green-100 text-green-700',
    cancelled: 'bg-slate-100 text-slate-600',
  };
  return map[s] || 'bg-slate-100';
}

export default function SupportPage() {
  const [searchParams] = useSearchParams();
  const [laptops, setLaptops] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [subject, setSubject] = useState('');
  const [ticketType, setTicketType] = useState(ISSUE_TYPES[0]);
  const [ttsplId, setTtsplId] = useState(searchParams.get('ttspl') || '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/laptops').then(({ data }) => setLaptops(data.laptops || []));
    api.get('/tickets').then(({ data }) => setTickets(data.tickets || []));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = searchParams.get('ttspl');
    if (t) setTtsplId(t);
  }, [searchParams]);

  async function submit(e) {
    e.preventDefault();
    if (description.length < 20) {
      toast.error('Description must be at least 20 characters');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/tickets', {
        subject,
        description,
        ticket_type: ticketType,
        ttspl_id: ttsplId || undefined,
        photos: [],
      });
      toast.success(`Ticket ${data.ticket_number} created`);
      setSubject('');
      setDescription('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit ticket');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Support</h1>

      <form onSubmit={submit} className="bg-white border rounded-xl p-6 space-y-4 max-w-2xl">
        <h2 className="font-semibold">Raise a Ticket</h2>
        <label className="block text-sm">
          Subject *
          <input required value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2" />
        </label>
        <label className="block text-sm">
          Issue Type *
          <select value={ticketType} onChange={(e) => setTicketType(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2">
            {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Which Laptop
          <select value={ttsplId} onChange={(e) => setTtsplId(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2">
            <option value="">— Select —</option>
            {laptops.map((l) => (
              <option key={l.ttspl_id} value={l.ttspl_id}>{l.ttspl_id} — {l.brand} {l.model}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Description * (min 20 chars)
          <textarea required minLength={20} value={description} onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[100px]" />
        </label>
        <button type="submit" disabled={busy} className="px-4 py-2 bg-brand text-white rounded-lg font-semibold disabled:opacity-50">
          Submit Ticket
        </button>
      </form>

      <div className="bg-white border rounded-xl overflow-hidden">
        <h2 className="font-semibold p-4 border-b">My Tickets</h2>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
            <tr>
              {['Ticket #', 'Subject', 'Laptop', 'Status', 'Created', 'Updated'].map((h) => <th key={h} className="p-3">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-slate-500">No tickets yet</td></tr>
            ) : tickets.map((t) => (
              <React.Fragment key={t.ticket_id}>
                <tr className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(expanded === t.ticket_id ? null : t.ticket_id)}>
                  <td className="p-3 font-mono text-xs">T-{t.ticket_id}</td>
                  <td className="p-3">{t.subject || '—'}</td>
                  <td className="p-3 font-mono text-xs">{t.ttspl_id || '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${ticketStatusClass(t.status)}`}>{t.status}</span>
                  </td>
                  <td className="p-3 text-xs">{t.created_at ? format(new Date(t.created_at), 'dd MMM yyyy') : '—'}</td>
                  <td className="p-3 text-xs">{t.updated_at ? format(new Date(t.updated_at), 'dd MMM yyyy') : '—'}</td>
                </tr>
                {expanded === t.ticket_id && (
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="p-4 text-sm text-slate-600">
                      Type: {t.type || '—'} · Status: {t.status}
                      {t.status === 'closed' && <p className="mt-2 text-green-700">This ticket has been resolved.</p>}
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
