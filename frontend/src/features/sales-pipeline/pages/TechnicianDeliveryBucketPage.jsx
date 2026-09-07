import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MapPin, Phone, KeyRound, Map as MapIcon, CheckCircle2, Truck } from 'lucide-react';
import { listDeliveryFlow, sendDeliveryOtp } from '../salesPipelineApi';
import {
  deliveryAddressPhone,
  formatDeliveryAddressLine,
  statusLabel,
} from '../salesPipelineUtils';
import InPersonDeliverModal from '../components/InPersonDeliverModal';

function timeSince(dateStr) {
  if (!dateStr) return '-';
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

export default function TechnicianDeliveryBucketPage({ movement = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [techFilter, setTechFilter] = useState('all');
  const [deliverModal, setDeliverModal] = useState(null);
  const [sendingOtp, setSendingOtp] = useState(null);
  const isReturn = movement === 'return';

  const handleSendOtp = async (dc) => {
    setSendingOtp(dc.dc_number);
    try {
      const r = await sendDeliveryOtp(dc.dc_number, {});
      toast.success(r.data?.message || 'OTP sent to the customer on WhatsApp. Ask them for the code.');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to send OTP');
    } finally {
      setSendingOtp(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Sales technician bucket shows outbound Delivery Challans (DC) only.
      // Return DCs (RDC / support pickups) belong in the Support pickup bucket.
      const apiMovement = movement || 'outbound';
      const r = await listDeliveryFlow({ status: 'inhouse', movement: apiMovement });
      let list = r.data?.items || [];
      // Safety net in case older rows come back without movement_type set.
      list = list.filter((d) => (d.movement_type || 'outbound') === apiMovement);
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
            <Truck className="w-6 h-6 text-blue-600" />
            {isReturn ? 'Pickup Bucket' : 'Technician Delivery Bucket'}
          </h1>
          <p className="text-sm text-gray-500">
            {isReturn
              ? 'In-house return pickups currently with technicians'
              : 'In-person deliveries only. Send OTP to the customer, then enter the code they received — technicians cannot see the OTP.'}
          </p>
        </div>
        <select
          value={techFilter}
          onChange={(e) => setTechFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          {technicians.map((t) => (
            <option key={t} value={t}>{t === 'all' ? 'All Technicians' : t}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
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
                  const addrText = formatDeliveryAddressLine(dc.delivery_address);
                  const phone = deliveryAddressPhone(dc.delivery_address, dc.customer_phone);
                  const mapsUrl = (dc.tech_latitude && dc.tech_longitude)
                    ? `https://www.google.com/maps?q=${dc.tech_latitude},${dc.tech_longitude}`
                    : null;
                  return (
                    <div key={dc.dc_number} className="bg-white border rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-blue-700">{dc.dc_number}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE(dc.status)}`}>
                          {statusLabel(dc.status)} | {timeSince(dc.reached_at || dc.dispatched_at)}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{dc.customer_name}</p>
                      <p className="text-sm text-gray-600 flex items-start gap-1.5">
                        <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                        {addrText || '-'}
                      </p>
                      {phone ? (
                        <p className="text-sm text-gray-600 flex items-center gap-1.5">
                          <Phone className="w-4 h-4 text-gray-400" />
                          {phone}
                        </p>
                      ) : null}
                      <div className="border-t pt-2 space-y-1">
                        {dc.serials.map((s, i) => (
                          <p key={i} className="text-xs text-gray-600">
                            <span className="font-mono text-gray-800">{s.ttspl}</span>
                            {' | '}
                            {[s.brand, s.model, s.processor, s.ram, s.storage].filter(Boolean).join(' | ')}
                          </p>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {dc.otp_verified_at ? (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700">
                            OTP verified
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={sendingOtp === dc.dc_number}
                            onClick={() => handleSendOtp(dc)}
                            className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-700 flex items-center gap-1 disabled:opacity-50"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            {sendingOtp === dc.dc_number
                              ? 'Sending…'
                              : dc.otp_sent_at
                                ? 'Resend OTP'
                                : 'Send OTP to customer'}
                          </button>
                        )}
                        {dc.otp_sent_at && !dc.otp_verified_at ? (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700">
                            OTP sent · ask customer
                          </span>
                        ) : null}
                        {mapsUrl && (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1"
                          >
                            <MapIcon className="w-3.5 h-3.5" /> Track Location
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={!dc.otp_sent_at && !dc.otp_verified_at}
                          title={
                            dc.otp_sent_at || dc.otp_verified_at
                              ? 'Enter the customer OTP to confirm delivery'
                              : 'Send OTP to the customer first'
                          }
                          onClick={() => {
                            if (!dc.otp_sent_at && !dc.otp_verified_at) {
                              toast.error('Send OTP to the customer first, then ask them for the code.');
                              return;
                            }
                            setDeliverModal(dc);
                          }}
                          className="text-xs px-2.5 py-1 rounded-lg border border-emerald-200 text-emerald-700 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Confirm delivery
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

      {deliverModal && (
        <InPersonDeliverModal
          dc={deliverModal}
          onClose={() => setDeliverModal(null)}
          onDelivered={load}
        />
      )}
    </div>
  );
}
