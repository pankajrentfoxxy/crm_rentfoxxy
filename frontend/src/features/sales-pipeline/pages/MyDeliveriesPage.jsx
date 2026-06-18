import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  MapPin, Map as MapIcon, Camera, PenLine, CheckCircle2, Loader2, Phone, User, Laptop,
} from 'lucide-react';
import {
  getMyDeliveries, markReached, verifySerialAndGenerateOtp, submitDeliveryWithPod,
} from '../salesPipelineApi';
import SignaturePadComponent from '../components/SignaturePad';

function StatusBadge({ status }) {
  const map = {
    in_transit: 'bg-blue-100 text-blue-700',
    reached: 'bg-amber-100 text-amber-700',
  };
  const label = { in_transit: 'In Transit', reached: 'Reached' }[status] || status;
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-700'}`}>{label}</span>;
}

function LaptopLine({ s }) {
  return (
    <div className="text-sm text-gray-700">
      <p className="font-medium flex items-center gap-1.5"><Laptop className="w-4 h-4 text-gray-400" /> {[s.brand, s.model].filter(Boolean).join(' ') || s.ttspl}</p>
      <p className="text-xs text-gray-500 ml-5">
        {[s.ttspl, s.processor, s.generation, s.ram, s.storage].filter(Boolean).join(' | ')}
      </p>
    </div>
  );
}

function DeliveryCard({ dc, onChanged }) {
  const [serial, setSerial] = useState('');
  const [otp, setOtp] = useState('');
  const [podType, setPodType] = useState('photo');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [esignData, setEsignData] = useState(null);
  const [showSign, setShowSign] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const addr = dc.delivery_address || {};
  const addrText = [addr.address, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
  const mapsUrl = (dc.tech_latitude && dc.tech_longitude)
    ? `https://www.google.com/maps?q=${dc.tech_latitude},${dc.tech_longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrText || dc.customer_name || '')}`;

  const handleReached = () => {
    const send = (lat, lng) => {
      setBusy(true);
      markReached(dc.dc_number, { latitude: lat, longitude: lng })
        .then(() => { toast.success('Marked as reached. Verify the laptop serial next.'); onChanged(); })
        .catch((e) => toast.error(e.response?.data?.message || 'Failed to mark reached'))
        .finally(() => setBusy(false));
    };
    if (!navigator.geolocation) {
      send(null, null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => send(String(pos.coords.latitude), String(pos.coords.longitude)),
      () => { toast('Location unavailable — marking reached without coordinates'); send(null, null); },
      { timeout: 10000, maximumAge: 60000 }
    );
  };

  const handleVerifySerial = async () => {
    if (!serial.trim()) { toast.error('Enter the laptop serial / TTSPL ID'); return; }
    setBusy(true);
    try {
      const r = await verifySerialAndGenerateOtp(dc.dc_number, { serial_number: serial.trim() });
      toast.success(r.data?.message || 'OTP sent to admin email');
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Serial verification failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleConfirm = async () => {
    if (!otp.trim()) { toast.error('Enter the OTP from the customer'); return; }
    if (podType === 'photo' && !photoFile) { toast.error('Capture a POD photo or choose another POD option'); return; }
    if (podType === 'esign' && !esignData) { toast.error('Capture the customer signature'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('otp', otp.trim());
      fd.append('pod_type', podType);
      fd.append('notes', notes);
      if (podType === 'photo' && photoFile) fd.append('pod_photo', photoFile);
      if (podType === 'esign' && esignData) fd.append('esign_data', esignData);
      await submitDeliveryWithPod(dc.dc_number, fd);
      toast.success('Delivery confirmed ✓');
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not confirm delivery');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="font-mono font-semibold text-blue-700">{dc.dc_number}</span>
        <StatusBadge status={dc.status} />
      </div>
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium flex items-center gap-1.5"><User className="w-4 h-4 text-gray-400" /> {addr.name || dc.customer_name}</p>
          {(addr.phone || dc.customer_phone) && (
            <a href={`tel:${addr.phone || dc.customer_phone}`} className="text-sm text-blue-600 flex items-center gap-1.5">
              <Phone className="w-4 h-4" /> {addr.phone || dc.customer_phone}
            </a>
          )}
          <p className="text-sm text-gray-600 flex items-start gap-1.5"><MapPin className="w-4 h-4 text-gray-400 mt-0.5" /> {addrText || '—'}</p>
          {addr.landmark && <p className="text-xs text-gray-500 ml-5">📍 {addr.landmark}</p>}
          {addr.is_wfh && <span className="ml-5 inline-block px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">WFH delivery</span>}
        </div>

        <div className="border-t pt-3 space-y-2">
          {dc.serials.map((s, i) => <LaptopLine key={i} s={s} />)}
        </div>

        {/* STATE: in transit -> mark reached */}
        {dc.status === 'in_transit' && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" disabled={busy} onClick={handleReached}
              className="flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />} Mark as Reached
            </button>
            <a href={mapsUrl} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 py-3 border rounded-xl text-sm font-medium">
              <MapIcon className="w-4 h-4" /> Open in Maps
            </a>
          </div>
        )}

        {/* STATE: reached, serial not yet verified -> Step 1 */}
        {dc.status === 'reached' && !dc.otp_pending && (
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase">Step 1 · Verify Laptop Serial</p>
            <div className="flex gap-2">
              <input value={serial} onChange={(e) => setSerial(e.target.value)}
                placeholder="Serial number / TTSPL ID"
                className="flex-1 border rounded-xl px-3 py-3 text-sm" />
              <button type="button" disabled={busy} onClick={handleVerifySerial}
                className="px-4 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
              </button>
            </div>
          </div>
        )}

        {/* STATE: reached, OTP sent -> Step 2 OTP + POD + confirm */}
        {dc.status === 'reached' && dc.otp_pending && (
          <div className="border-t pt-3 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Step 2 · Enter OTP from Customer</p>
              <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric"
                placeholder="6-digit OTP" className="w-full border rounded-xl px-3 py-3 text-sm tracking-widest" />
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Proof of Delivery</p>
              <div className="flex gap-2 text-xs mb-2">
                {[['photo', 'Photo'], ['esign', 'E-Sign'], ['none', 'Skip']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setPodType(val)}
                    className={`flex-1 py-2 rounded-lg border ${podType === val ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-600'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {podType === 'photo' && (
                <label className="cursor-pointer block">
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
                  <div className="border-2 border-dashed border-blue-200 rounded-xl p-5 text-center bg-blue-50">
                    {photoPreview ? (
                      <img src={photoPreview} alt="POD" className="max-h-44 mx-auto rounded-lg" />
                    ) : (
                      <>
                        <Camera className="w-9 h-9 text-blue-400 mx-auto mb-2" />
                        <p className="text-sm text-blue-700 font-medium">Tap to take photo</p>
                        <p className="text-xs text-blue-500">Photo of delivered laptop at customer site</p>
                      </>
                    )}
                  </div>
                </label>
              )}

              {podType === 'esign' && (
                showSign ? (
                  <SignaturePadComponent
                    onSave={(data) => { setEsignData(data); setShowSign(false); toast.success('Signature captured'); }}
                    onCancel={() => setShowSign(false)}
                  />
                ) : (
                  <button type="button" onClick={() => setShowSign(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 border rounded-xl text-sm font-medium">
                    <PenLine className="w-4 h-4" /> {esignData ? 'Signature captured · Re-sign' : 'Open Signature Pad'}
                  </button>
                )
              )}
            </div>

            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Delivery notes (optional)" className="w-full border rounded-xl px-3 py-2.5 text-sm" />

            <button type="button" disabled={busy} onClick={handleConfirm}
              className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Confirm Delivery
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MyDeliveriesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyDeliveries();
      setItems(r.data?.items || []);
    } catch {
      toast.error('Failed to load your deliveries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const todayCount = items.filter((d) => {
    if (!d.dispatched_at) return false;
    return new Date(d.dispatched_at).toDateString() === new Date().toDateString();
  }).length;

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">My Deliveries</h1>
        <div className="flex gap-2 mt-2">
          <span className="px-3 py-1 rounded-full text-xs bg-blue-50 text-blue-700">Today: {todayCount}</span>
          <span className="px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-700">All Active: {items.length}</span>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : items.length === 0 ? (
        <div className="bg-white border rounded-2xl p-8 text-center text-gray-500 text-sm">
          No active deliveries assigned to you right now.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((dc) => <DeliveryCard key={dc.dc_number} dc={dc} onChanged={load} />)}
        </div>
      )}
    </div>
  );
}
