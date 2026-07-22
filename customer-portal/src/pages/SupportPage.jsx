import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import api from '../utils/api';
import { formatIndianMobileInput, indianMobileError, normalizeIndianMobile } from '../utils/phoneValidation';

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
  const initialType = ISSUE_TYPES.includes(searchParams.get('type')) ? searchParams.get('type') : ISSUE_TYPES[0];
  const [subject, setSubject] = useState(searchParams.get('type') === 'Return Request' ? 'Laptop return request' : '');
  const [ticketType, setTicketType] = useState(initialType);
  const [ttsplId, setTtsplId] = useState(searchParams.get('ttspl') || '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const emptyAddr = { name: '', phone: '', address: '', city: '', state: '', pincode: '', landmark: '' };
  const [pickupAddr, setPickupAddr] = useState(emptyAddr);
  const isReturn = ticketType === 'Return Request';

  const load = () => {
    api.get('/laptops')
      .then(({ data }) => setLaptops(data.laptops || []))
      .catch(() => setLaptops([]));
    api.get('/tickets')
      .then(({ data }) => setTickets(data.tickets || []))
      .catch(() => setTickets([]));
    // Prefill pickup address from the customer's shipping/billing address.
    api.get('/me')
      .then(({ data }) => {
        const useShip = data.shipping_address && data.shipping_same === false;
        setPickupAddr((p) => (p.address ? p : {
          name: data.company_name || data.name || '',
          phone: data.phone || data.whatsapp_number || '',
          address: (useShip ? data.shipping_address : data.billing_address) || data.billing_address || '',
          city: (useShip ? data.shipping_city : data.billing_city) || data.billing_city || '',
          state: (useShip ? data.shipping_state : data.billing_state) || data.billing_state || '',
          pincode: (useShip ? data.shipping_pincode : data.billing_pincode) || data.billing_pincode || '',
          landmark: '',
        }));
      })
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = searchParams.get('ttspl');
    if (t) setTtsplId(t);
    const ty = searchParams.get('type');
    if (ty && ISSUE_TYPES.includes(ty)) setTicketType(ty);
  }, [searchParams]);

  async function submit(e) {
    e.preventDefault();
    if (description.length < 20) {
      toast.error('Description must be at least 20 characters');
      return;
    }
    if (isReturn && (!pickupAddr.address || !pickupAddr.city || !pickupAddr.pincode)) {
      toast.error('Please provide the pickup address (address, city, pincode)');
      return;
    }
    if (isReturn && pickupAddr.phone?.trim()) {
      const phoneErr = indianMobileError(pickupAddr.phone, { label: 'Pickup phone' });
      if (phoneErr) {
        toast.error(phoneErr);
        return;
      }
    }
    setBusy(true);
    try {
      const { data } = await api.post('/tickets', {
        subject,
        description,
        ticket_type: ticketType,
        ttspl_id: ttsplId || undefined,
        pickup_address: isReturn
          ? { ...pickupAddr, phone: pickupAddr.phone?.trim() ? normalizeIndianMobile(pickupAddr.phone) : '' }
          : undefined,
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
        {isReturn && (
          <div className="border rounded-lg p-3 bg-amber-50/50 space-y-2">
            <p className="text-sm font-semibold text-amber-800">Pickup Address</p>
            <p className="text-xs text-slate-500">Our team will collect the laptop from this address.</p>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Contact name" value={pickupAddr.name} onChange={(e) => setPickupAddr((a) => ({ ...a, name: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Phone" value={pickupAddr.phone} onChange={(e) => setPickupAddr((a) => ({ ...a, phone: formatIndianMobileInput(e.target.value) }))} className="border rounded-lg px-3 py-2 text-sm" maxLength={10} inputMode="numeric" />
            </div>
            <input placeholder="Address *" value={pickupAddr.address} onChange={(e) => setPickupAddr((a) => ({ ...a, address: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" />
            <div className="grid grid-cols-3 gap-2">
              <input placeholder="City *" value={pickupAddr.city} onChange={(e) => setPickupAddr((a) => ({ ...a, city: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
              <input placeholder="State" value={pickupAddr.state} onChange={(e) => setPickupAddr((a) => ({ ...a, state: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Pincode *" value={pickupAddr.pincode} onChange={(e) => setPickupAddr((a) => ({ ...a, pincode: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
            </div>
            <input placeholder="Landmark (optional)" value={pickupAddr.landmark} onChange={(e) => setPickupAddr((a) => ({ ...a, landmark: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        )}

        <label className="block text-sm">
          Description * (min 20 chars)
          <textarea required minLength={20} value={description} onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[100px]" />
        </label>
        <button type="submit" disabled={busy} className="px-4 py-2 bg-brand text-white rounded-lg font-semibold disabled:opacity-50">
          Submit Ticket
        </button>
      </form>

      {/* Mobile ticket cards */}
      <div className="md:hidden space-y-3">
        <h2 className="font-semibold">My Tickets</h2>
        {tickets.length === 0 ? (
          <p className="bg-white border rounded-xl p-6 text-center text-slate-500">No tickets yet</p>
        ) : tickets.map((t) => (
          <div key={t.ticket_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-slate-900">T-{t.ticket_id}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${ticketStatusClass(t.status)}`}>{t.status}</span>
            </div>
            <p className="text-sm font-medium text-slate-900">{t.subject || '—'}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {t.ttspl_id && <span className="font-mono">{t.ttspl_id}</span>}
              <span>Created {t.created_at ? format(new Date(t.created_at), 'dd MMM yyyy') : '—'}</span>
            </div>
            {t.status === 'closed' && <p className="text-xs text-green-700 pt-1 border-t border-slate-100">This ticket has been resolved.</p>}
          </div>
        ))}
      </div>

      <div className="hidden md:block bg-white border rounded-xl overflow-hidden">
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
