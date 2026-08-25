import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  formatIndianMobileInput, indianMobileError, normalizeIndianMobile,
} from '../utils/phoneValidation';

const ISSUE_TYPES = [
  'Laptop Not Working', 'Display Issue', 'Keyboard Issue', 'Battery Issue',
  'Software Issue', 'Replacement Request', 'Return Request', 'Other',
];

const INPUT = 'w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none';

const EMPTY_ADDRESS = {
  name: '', phone: '', address: '', city: '', state: '', pincode: '', landmark: '',
};

export default function CreateTicketPage() {
  const { readOnly } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [laptops, setLaptops] = useState([]);
  const [busy, setBusy] = useState(false);

  const presetType = searchParams.get('type');
  const [ticketType, setTicketType] = useState(
    ISSUE_TYPES.includes(presetType) ? presetType : ISSUE_TYPES[0]
  );
  const [subject, setSubject] = useState(
    presetType === 'Return Request' ? 'Laptop return request' : ''
  );
  const [ttsplId, setTtsplId] = useState(searchParams.get('ttspl') || '');
  const [description, setDescription] = useState('');
  const [pickupAddr, setPickupAddr] = useState(EMPTY_ADDRESS);

  const isReturn = ticketType === 'Return Request';

  useEffect(() => {
    api.get('/laptops', { params: { limit: 200 } })
      .then(({ data }) => setLaptops(data.laptops || []))
      .catch(() => setLaptops([]));

    // Prefill the pickup address from the account's shipping/billing address.
    api.get('/me')
      .then(({ data }) => {
        const useShip = data.shipping_address && data.shipping_same === false;
        setPickupAddr((prev) => (prev.address ? prev : {
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
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (description.trim().length < 20) {
      toast.error('Please describe the issue in at least 20 characters');
      return;
    }
    if (isReturn && (!pickupAddr.address || !pickupAddr.city || !pickupAddr.pincode)) {
      toast.error('Pickup address needs at least address, city and pincode');
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
          ? {
            ...pickupAddr,
            phone: pickupAddr.phone?.trim() ? normalizeIndianMobile(pickupAddr.phone) : '',
          }
          : undefined,
        photos: [],
      });
      toast.success(`Ticket ${data.ticket_number} created`);
      navigate(`/support/tickets/${data.ticket_id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not submit the ticket');
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) {
    return (
      <div className="space-y-4">
        <Link to="/support/tickets" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to tickets
        </Link>
        <div className="bg-white border rounded-xl p-6 text-sm text-slate-600 max-w-2xl">
          <h1 className="text-lg font-bold text-slate-900">Create Support Ticket</h1>
          <p className="mt-2">
            This is a read-only admin preview, so a ticket cannot be raised as the customer.
            Create it from the Support module in the CRM instead.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/support/tickets" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to tickets
      </Link>

      <div>
        <h1 className="text-xl font-bold">Create Support Ticket</h1>
        <p className="text-sm text-slate-500 mt-1">
          Tell us what is wrong and we will pick it up from here.
        </p>
      </div>

      <form onSubmit={submit} className="bg-white border rounded-xl p-6 space-y-4 max-w-2xl">
        <label className="block text-sm">
          <span className="text-slate-700">Subject *</span>
          <input
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Short summary of the problem"
            className={`mt-1 ${INPUT}`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-700">Issue Type *</span>
          <select
            value={ticketType}
            onChange={(e) => setTicketType(e.target.value)}
            className={`mt-1 ${INPUT} bg-white`}
          >
            {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-slate-700">Which Laptop</span>
          <select
            value={ttsplId}
            onChange={(e) => setTtsplId(e.target.value)}
            className={`mt-1 ${INPUT} bg-white`}
          >
            <option value="">— Select a laptop —</option>
            {laptops.map((l) => (
              <option key={l.ttspl_id} value={l.ttspl_id}>
                {l.ttspl_id} — {[l.brand, l.model].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
          {laptops.length === 0 && (
            <span className="block text-xs text-slate-400 mt-1">
              No active laptops found on your account.
            </span>
          )}
        </label>

        {isReturn && (
          <div className="border rounded-lg p-3 bg-amber-50/50 space-y-2">
            <p className="text-sm font-semibold text-amber-800">Pickup Address</p>
            <p className="text-xs text-slate-500">Our team will collect the laptop from this address.</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Contact name"
                value={pickupAddr.name}
                onChange={(e) => setPickupAddr((a) => ({ ...a, name: e.target.value }))}
                className={INPUT}
              />
              <input
                placeholder="Phone"
                value={pickupAddr.phone}
                onChange={(e) => setPickupAddr((a) => ({ ...a, phone: formatIndianMobileInput(e.target.value) }))}
                className={INPUT}
                maxLength={10}
                inputMode="numeric"
              />
            </div>
            <input
              placeholder="Address *"
              value={pickupAddr.address}
              onChange={(e) => setPickupAddr((a) => ({ ...a, address: e.target.value }))}
              className={INPUT}
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                placeholder="City *"
                value={pickupAddr.city}
                onChange={(e) => setPickupAddr((a) => ({ ...a, city: e.target.value }))}
                className={INPUT}
              />
              <input
                placeholder="State"
                value={pickupAddr.state}
                onChange={(e) => setPickupAddr((a) => ({ ...a, state: e.target.value }))}
                className={INPUT}
              />
              <input
                placeholder="Pincode *"
                value={pickupAddr.pincode}
                onChange={(e) => setPickupAddr((a) => ({ ...a, pincode: e.target.value }))}
                className={INPUT}
              />
            </div>
            <input
              placeholder="Landmark (optional)"
              value={pickupAddr.landmark}
              onChange={(e) => setPickupAddr((a) => ({ ...a, landmark: e.target.value }))}
              className={INPUT}
            />
          </div>
        )}

        <label className="block text-sm">
          <span className="text-slate-700">Description * (min 20 characters)</span>
          <textarea
            required
            minLength={20}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happens, when it started, anything you have already tried…"
            className={`mt-1 ${INPUT} min-h-[120px]`}
          />
          <span className="block text-xs text-slate-400 mt-1">{description.trim().length}/20</span>
        </label>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-brand text-white rounded-lg font-semibold text-sm disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit Ticket'}
          </button>
          <Link to="/support/tickets" className="px-4 py-2 border rounded-lg font-semibold text-sm">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
