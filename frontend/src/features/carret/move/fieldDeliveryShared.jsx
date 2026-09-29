import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, DocNumber, Notice, Segmented } from '../../../components/carret';
import ScanField from '../../../components/ScanField';
import SignaturePadComponent from '../../sales-pipeline/components/SignaturePad';
import { formatDeliveryAddressLine, deliveryAddressPhone } from '../../sales-pipeline/salesPipelineUtils';

/**
 * Pieces shared by the cards on Field → My deliveries (delivery, return pickup,
 * vendor hand-over). Field density: one big button per step, scans through
 * ScanField (gun, typing or phone camera).
 */
export const errMsg = (e) => e?.response?.data?.message || e?.message || 'That did not work.';
export const BIG = { width: '100%', minHeight: '56px' };

/**
 * One action at a time per card. The ref closes the double-tap window before
 * React re-renders the disabled button — a second tap never sends a second
 * request.
 */
export function useRunner(onChanged) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async (fn, ok) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast.success(typeof ok === 'function' ? ok(r) : ok);
      onChanged?.();
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [onChanged]);
  return { busy, run };
}

/** GPS if the phone gives it within 10 s, else no coordinates. */
export function withGps(send) {
  if (!navigator.geolocation) { send(null, null); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => send(String(p.coords.latitude), String(p.coords.longitude)),
    () => send(null, null),
    { timeout: 10000, maximumAge: 60000 }
  );
}

const PURPOSE = {
  replacement: 'Replacement',
  vendor_return: 'Return to vendor',
  vendor_repair: 'Repair — to vendor',
  part_return: 'Part pickup',
};

/** Header: number, what kind of job, who, where, call / map, the laptops. */
export function CardHead({ dc, kindLabel }) {
  const addr = formatDeliveryAddressLine(dc.delivery_address);
  const phone = deliveryAddressPhone(dc.delivery_address, dc.customer_phone);
  const maps = (dc.tech_latitude && dc.tech_longitude)
    ? `https://www.google.com/maps?q=${dc.tech_latitude},${dc.tech_longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr || dc.customer_name || '')}`;
  const status = String(dc.status || '').toLowerCase();
  return (
    <>
      <div className="flex items-baseline flex-wrap" style={{ gap: '8px' }}>
        <DocNumber value={dc.dc_number} />
        <span className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)', fontWeight: 600 }}>
          {[kindLabel, PURPOSE[dc.dc_purpose]].filter(Boolean).join(' · ')}
        </span>
        <span className="ml-auto font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{status.replace(/_/g, ' ')}</span>
      </div>
      <div className="font-ui text-ink" style={{ fontWeight: 600, marginTop: '6px' }}>{dc.delivery_address?.name || dc.customer_name}</div>
      {addr && <div className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>{addr}</div>}
      {dc.delivery_address?.landmark && <div className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>Landmark: {dc.delivery_address.landmark}</div>}
      {dc.delivery_address?.is_wfh && <div className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>Work-from-home address</div>}
      <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '10px' }}>
        {phone && <a className="c-btn" style={{ minHeight: '48px' }} href={`tel:${phone}`}>Call {phone}</a>}
        <a className="c-btn" style={{ minHeight: '48px' }} href={maps} target="_blank" rel="noreferrer">Map</a>
      </div>
    </>
  );
}

export function LaptopList({ serials = [], scannedKeys = null }) {
  if (!serials.length) return null;
  return (
    <ul className="list-none p-0 m-0 font-ui" style={{ marginTop: '10px', display: 'grid', gap: '6px' }}>
      {serials.map((s, i) => {
        const done = scannedKeys ? scannedKeys.has(String(i)) : null;
        return (
          <li key={`${s.ttspl}-${s.serial_number}-${i}`} className="flex items-baseline" style={{ gap: '8px' }}>
            {done !== null && (
              <span aria-label={done ? 'scanned' : 'not scanned'} style={{ color: done ? 'var(--alert-good)' : 'var(--ink-3)', fontWeight: 700, minWidth: '1.2em' }}>{done ? '✓' : '○'}</span>
            )}
            <span className="min-w-0">
              <span className="font-mono text-ink">{s.ttspl || s.serial_number}</span>
              {s.serial_number && s.ttspl && <span className="font-mono text-ink-3"> · {s.serial_number}</span>}
              <span className="block text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>
                {[s.brand, s.model, s.processor, s.generation, s.ram, s.storage].filter(Boolean).join(' · ')}
                {s.issue_type ? ` — ${s.issue_type}` : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const norm = (v) => String(v || '').trim().toLowerCase();

/** Which laptop on the card a scanned code is, by TTSPL or serial; null if none. */
export function laptopKeyFor(serials, code) {
  const c = norm(code);
  if (!c) return null;
  const i = (serials || []).findIndex((s) => norm(s.ttspl) === c || norm(s.serial_number) === c);
  return i < 0 ? null : String(i);
}

/**
 * Scan every laptop on the challan. A code that is not on it, or a laptop
 * already scanned, is said out loud and never counted. The server checks the
 * same rules again (fieldScanMatch).
 */
export function LaptopScanList({ serials, scanned, onScanned, disabled }) {
  const [code, setCode] = useState('');
  const [last, setLast] = useState(null);
  const keys = new Set(Object.keys(scanned));
  const take = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    const key = laptopKeyFor(serials, value);
    if (key === null) setLast({ tone: 'crit', text: `${value} is not on this challan — do not collect it` });
    else if (scanned[key]) setLast({ tone: 'warn', text: `${serials[key].ttspl || value} is already scanned` });
    else {
      onScanned({ ...scanned, [key]: value });
      setLast({ tone: 'good', text: `${serials[key].ttspl || value} matched` });
    }
    setCode('');
  };
  return (
    <div className="c-stack" style={{ gap: '8px' }}>
      <div className="flex items-baseline">
        <strong className="font-ui">Scan each laptop</strong>
        <span className="ml-auto font-mono tabular-nums text-ink-2">{keys.size} / {serials.length}</span>
      </div>
      <ScanField value={code} onChange={setCode} onScan={take} disabled={disabled} placeholder="TTSPL or serial" aria-label="Scan a laptop" />
      <Button onClick={() => take(code)} disabled={disabled || !code.trim()} style={{ minHeight: '48px' }}>Check this laptop</Button>
      {last && <Notice tone={last.tone}>{last.text}</Notice>}
      <LaptopList serials={serials} scannedKeys={keys} />
    </div>
  );
}

function PhotoPick({ file, onFile, label }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div>
      <label className="c-btn" style={{ display: 'inline-flex', cursor: 'pointer', minHeight: '48px' }}>
        {file ? 'Retake photo' : label}
        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] || null)} />
      </label>
      {preview && <img src={preview} alt="" style={{ display: 'block', marginTop: '8px', maxHeight: '180px', borderRadius: 'var(--d-radius)', border: '1px solid var(--rule)' }} />}
    </div>
  );
}

function SignatureBox({ esign, onChange, label }) {
  if (esign) {
    return (
      <div className="c-stack" style={{ gap: '6px' }}>
        <img src={esign} alt={label} style={{ height: 90, background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--d-radius)' }} />
        <Button variant="quiet" onClick={() => onChange(null)}>Sign again</Button>
      </div>
    );
  }
  return <SignaturePadComponent onSave={(data) => onChange(data)} onCancel={() => onChange(null)} />;
}

export const emptyProof = () => ({ type: 'photo', file: null, esign: null });

/**
 * Proof at the door. mode 'customer': a photo OR the customer's signature.
 * mode 'vendor': the receiver's signature (required) plus an optional photo.
 */
export function ProofCapture({ mode = 'customer', value, onChange }) {
  if (mode === 'vendor') {
    return (
      <div className="c-stack" style={{ gap: '8px' }}>
        <strong className="font-ui">Receiver’s signature</strong>
        <SignatureBox esign={value.esign} label="Receiver signature" onChange={(esign) => onChange({ ...value, esign })} />
        <PhotoPick file={value.file} label="Photo of the handover (optional)" onFile={(file) => onChange({ ...value, file })} />
      </div>
    );
  }
  return (
    <div className="c-stack" style={{ gap: '8px' }}>
      <Segmented label="Proof" value={value.type} onChange={(type) => onChange({ type, file: null, esign: null })} options={[{ value: 'photo', label: 'Photo' }, { value: 'esign', label: 'Signature' }]} />
      {value.type === 'photo'
        ? <PhotoPick file={value.file} label="Take photo" onFile={(file) => onChange({ ...value, file })} />
        : <SignatureBox esign={value.esign} label="Customer signature" onChange={(esign) => onChange({ ...value, esign })} />}
    </div>
  );
}

/** FormData for POST /deliver from the proof + extra fields. */
export function proofForm(proof, fields = {}) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, v); });
  if (proof.file) fd.append('pod_photo', proof.file);
  if (proof.esign) fd.append('esign_data', proof.esign);
  return fd;
}
