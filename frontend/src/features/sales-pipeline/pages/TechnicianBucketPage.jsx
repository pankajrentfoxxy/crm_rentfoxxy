import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MapPin, Phone, KeyRound, Map as MapIcon, CheckCircle2, Truck } from 'lucide-react';
import { listDeliveryFlow } from '../salesPipelineApi';
import { formatDateTime, statusLabel } from '../salesPipelineUtils';
import AdminDeliverModal from '../components/AdminDeliverModal';

function timeSince(dateStr) {
  if (!dateStr) return '—';
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return `${hrs}h ${rem}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function STATUS_STYLE(s) {
  return s === 'reached' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700';
}

export default function TechnicianBucketPage({ movement = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [techFilter, setTechFilter] = useState('all');
  const [otpModal, setOtpModal] = useState(null);
  const [deliverModal, setDeliverModal] = useState(null);
  const isReturn = movement === 'return';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listDeliveryFlow({ status: 'inhouse' });
      let list = r.data?.items || [];
      if (movement) list = list.filter((d) => (d.movement_type || 'outbound') === movement);
      setItems(list);
    } catch {
      toast.error('Failed to load the bucket');
    } finally {
      setLoading(false);
    }
  }, [movement]);

  useEffect(() => { load(); }, [load]);

  const technicians = useMemo(() => {
    const set = new Set(items.map((d) => d.technician_name || 'Unassigned'));
    return ['all', ...Array.from(set)];
  }, [items]);

  const groups = useMemo(() => {
    const filtered = techFilter === 'all'
      ? items
      : items.filter((d) => (d.technician_name || 'Unassigned') === techFilter);
    const map = new Map();
    filtered.forEach((d) => {
      const key = d.technician_name || 'Unassigned';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(d);
    });
    return Array.from(map.entries());
  }, [items, techFilter]);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-blue-600" /> {isReturn ? 'Pickup Bucket' : 'Technician Delivery Bucket'}
          </h1>
          <p className="text-sm text-gray-500">{isReturn ? 'In-house return pickups currently with technicians' : 'In-house deliveries currently with technicians'}</p>
        </div>
        <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm">
          {technicians.map((t) => <option key={t} value={t}>{t === 'all' ? 'All Technicians' : t}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="bg-white border rounded-xl p-8 text-center text-gray-500 text-sm">
          No in-house deliveries in transit right now.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([tech, dcs]) => (
            <div key={tech}>
              <h2 className="text-sm font-semibold text-gray-700 uppercase mb-2">
                {tech} <span className="text-gray-400">({dcs.length} active)</span>
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {dcs.map((dc) => {
                  const addr = dc.delivery_address || {};
                  const addrText = [addr.address, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
                  const mapsUrl = (dc.tech_latitude && dc.tech_longitude)
                    ? `https://www.google.com/maps?q=${dc.tech_latitude},${dc.tech_longitude}`
                    : null;
                  return (
                    <div key={dc.dc_number} className="bg-white border rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-blue-700">{dc.dc_number}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE(dc.status)}`}>
                          {statusLabel(dc.status)} · {timeSince(dc.reached_at || dc.dispatched_at)}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{dc.customer_name}</p>
                      <p className="text-sm text-gray-600 flex items-start gap-1.5"><MapPin className="w-4 h-4 text-gray-400 mt-0.5" /> {addrText || '—'}</p>
                      {(addr.phone || dc.customer_phone) && (
                        <p className="text-sm text-gray-600 flex items-center gap-1.5"><Phone className="w-4 h-4 text-gray-400" /> {addr.phone || dc.customer_phone}</p>
                      )}
                      <div className="border-t pt-2 space-y-1">
                        {dc.serials.map((s, i) => (
                          <p key={i} className="text-xs text-gray-600">
                            <span className="font-mono text-gray-800">{s.ttspl}</span>
                            {' | '}{[s.brand, s.model, s.processor, s.ram, s.storage].filter(Boolean).join(' | ')}
                          </p>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {dc.otp_verified_at ? (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700">✓ OTP Verified</span>
                        ) : dc.otp_sent_at ? (
                          <button type="button" onClick={() => setOtpModal(dc)}
                            className="text-xs px-2.5 py-1 rounded-lg border border-blue-200 text-blue-700 flex items-center gap-1">
                            <KeyRound className="w-3.5 h-3.5" /> View OTP
                          </button>
                        ) : (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-gray-50 text-gray-500">OTP not generated</span>
                        )}
                        {mapsUrl && (
                          <a href={mapsUrl} target="_blank" rel="noreferrer"
                            className="text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1">
                            <MapIcon className="w-3.5 h-3.5" /> Track Location
                          </a>
                        )}
                        <button type="button" onClick={() => setDeliverModal(dc)}
                          className="text-xs px-2.5 py-1 rounded-lg border border-emerald-200 text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Mark Delivered
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {otpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setOtpModal(null)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-xs text-center">
            <h3 className="font-semibold mb-2">OTP — {otpModal.dc_number}</h3>
            <p className="text-3xl font-mono font-bold tracking-widest text-blue-700">{otpModal.otp_code || '——————'}</p>
            <p className="text-xs text-gray-500 mt-2">Sent {formatDateTime(otpModal.otp_sent_at)}</p>
            <p className="text-xs text-gray-400 mt-1">Share verbally with the customer.</p>
            <button type="button" onClick={() => setOtpModal(null)} className="mt-4 w-full py-2 border rounded-lg text-sm">Close</button>
          </div>
        </div>
      )}

      {deliverModal && (
        <AdminDeliverModal
          dc={deliverModal}
          onClose={() => setDeliverModal(null)}
          onDelivered={load}
        />
      )}
    </div>
  );
}
