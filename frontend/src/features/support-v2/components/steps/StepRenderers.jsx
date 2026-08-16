import React, { useRef, useState } from 'react';
import CameraScanner from '../../../../components/CameraScanner';
import { uploadAttachments } from '../../supportV2Api';
import ConditionGradingSheet from '../ConditionGradingSheet';

export function ConfirmStep({ onComplete, disabled }) {
  return (
    <button type="button" disabled={disabled} className="text-sup-accent underline text-[12px]" onClick={() => onComplete({})}>
      Confirm
    </button>
  );
}

export function GpsStep({ onComplete, disabled }) {
  const [err, setErr] = useState('');
  const grab = () => {
    if (!navigator.geolocation) { setErr('Geolocation unavailable'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => onComplete({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => setErr('Location denied')
    );
  };
  return (
    <div>
      <button type="button" disabled={disabled} className="text-sup-accent underline text-[12px]" onClick={grab}>Use current location</button>
      {err ? <div className="text-pri1 text-[11px]">{err}</div> : null}
    </div>
  );
}

export function ScanStep({ expected, onComplete, disabled }) {
  const [manual, setManual] = useState('');
  const [cam, setCam] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <input value={manual} disabled={disabled} onChange={(e) => setManual(e.target.value)} placeholder="Scan or type serial" className="flex-1 border rounded px-2 py-1 text-[12px]" />
        <button type="button" disabled={disabled} className="text-[12px] underline" onClick={() => onComplete({ scanned_value: manual, expected_value: expected })}>OK</button>
        <button type="button" disabled={disabled} className="text-[12px] underline" onClick={() => setCam((v) => !v)}>Camera</button>
      </div>
      {cam && !disabled && (
        <CameraScanner onScan={(v) => { setCam(false); onComplete({ scanned_value: v, expected_value: expected }); }} />
      )}
    </div>
  );
}

export function PhotoStep({ ticketId, minCount, onComplete, disabled }) {
  const [ids, setIds] = useState([]);
  const add = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    const r = await uploadAttachments(ticketId, files, { kind: 'PHOTO_CONDITION' });
    setIds((cur) => [...cur, ...(r.data?.rows || []).map((x) => x.attachment_id)]);
  };
  return (
    <div className="text-[12px] space-y-1">
      <label className="underline text-sup-accent cursor-pointer">
        ＋ Photos ({ids.length} / {minCount})
        <input type="file" accept="image/*" capture="environment" multiple disabled={disabled} className="hidden" onChange={add} />
      </label>
      <button type="button" disabled={disabled || ids.length < minCount} className="block underline" onClick={() => onComplete({ attachment_ids: ids })}>
        Save photos
      </button>
    </div>
  );
}

export function ChecklistStep({ onComplete, disabled }) {
  const defaults = [
    { code: 'CHARGER', label: 'Charger', checked: false, note: '' },
    { code: 'BAG', label: 'Bag', checked: false, note: '' },
    { code: 'MOUSE', label: 'Mouse', checked: false, note: '' },
  ];
  const [items, setItems] = useState(defaults);
  return (
    <div className="space-y-1 text-[12px]">
      {items.map((it, i) => (
        <label key={it.code} className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled={disabled}
            checked={it.checked}
            onChange={(e) => setItems((cur) => cur.map((x, idx) => (idx === i ? { ...x, checked: e.target.checked } : x)))}
          />
          {it.label}
        </label>
      ))}
      <button type="button" disabled={disabled} className="underline text-sup-accent" onClick={() => onComplete({ items })}>Save checklist</button>
    </div>
  );
}

export function OtpStep({ onComplete, disabled }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const refs = useRef([]);
  const setAt = (i, v) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    if (d && refs.current[i + 1]) refs.current[i + 1].focus();
  };
  return (
    <div className="flex items-center gap-1">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          disabled={disabled}
          maxLength={1}
          onChange={(e) => setAt(i, e.target.value)}
          className="w-8 h-9 text-center border rounded font-mono"
        />
      ))}
      <button type="button" disabled={disabled} className="underline text-[12px]" onClick={() => onComplete({ otp: digits.join('') })}>Verify</button>
    </div>
  );
}

export function SignatureStep({ ticketId, onComplete, disabled }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const start = async () => {
    const { default: SignaturePad } = await import('signature_pad');
    const pad = new SignaturePad(canvasRef.current, { backgroundColor: '#fff' });
    canvasRef.current._pad = pad;
    setReady(true);
  };
  const save = async () => {
    const pad = canvasRef.current?._pad;
    if (!pad || pad.isEmpty()) return;
    const blob = await (await fetch(pad.toDataURL())).blob();
    const file = new File([blob], 'signature.png', { type: 'image/png' });
    const r = await uploadAttachments(ticketId, [file], { kind: 'SIGNATURE' });
    onComplete({ attachment_id: r.data?.rows?.[0]?.attachment_id });
  };
  return (
    <div className="space-y-1">
      <canvas ref={canvasRef} width={320} height={120} className="border rounded w-full max-w-xs bg-white" />
      <div className="flex gap-2 text-[12px]">
        <button type="button" disabled={disabled} className="underline" onClick={start}>Enable pad</button>
        <button type="button" disabled={disabled || !ready} className="underline" onClick={save}>Save signature</button>
      </div>
    </div>
  );
}

export function FormStep({ onComplete, disabled }) {
  const [notes, setNotes] = useState('');
  return (
    <div>
      <textarea disabled={disabled} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full border rounded px-2 py-1 text-[12px]" placeholder="Notes" />
      <button type="button" disabled={disabled} className="underline text-[12px]" onClick={() => onComplete({ notes })}>Save</button>
    </div>
  );
}

const DATA_TRANSFER_OPTS = [
  { value: 'NOT_REQUIRED', label: 'Not required — customer uses cloud only' },
  { value: 'DONE_ON_SITE', label: 'Done on site — files copied and verified with the user' },
  { value: 'CUSTOMER_WILL_DO', label: 'Customer will do it themselves — old unit left with them for 24 h' },
  { value: 'BACKUP_TAKEN', label: 'Backup taken to external drive — handed to customer' },
];

export function DataTransferStep({ onComplete, disabled }) {
  const [choice, setChoice] = useState('');
  return (
    <div className="space-y-1 text-[12px]">
      {DATA_TRANSFER_OPTS.map((o) => (
        <label key={o.value} className="flex items-start gap-2">
          <input type="radio" disabled={disabled} checked={choice === o.value} onChange={() => setChoice(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
      <button type="button" disabled={disabled || !choice} className="underline text-sup-accent" onClick={() => onComplete({ data_transfer: choice })}>
        Save data transfer
      </button>
    </div>
  );
}

export function StepBody({ step, ticketId, expected, disabled, onComplete, wo, assets }) {
  if (step.step_code === 'GRADE') {
    return <ConditionGradingSheet wo={wo} assets={assets} ticketId={ticketId} disabled={disabled} onComplete={onComplete} />;
  }
  if (step.step_code === 'DATA_TRANSFER') {
    return <DataTransferStep disabled={disabled} onComplete={onComplete} />;
  }
  const kind = step.step_kind;
  if (kind === 'GPS') return <GpsStep disabled={disabled} onComplete={onComplete} />;
  if (kind === 'SCAN') return <ScanStep disabled={disabled} expected={expected} onComplete={onComplete} />;
  if (kind === 'PHOTO') return <PhotoStep disabled={disabled} ticketId={ticketId} minCount={step.min_count || 1} onComplete={onComplete} />;
  if (kind === 'CHECKLIST') return <ChecklistStep disabled={disabled} onComplete={onComplete} />;
  if (kind === 'OTP') return <OtpStep disabled={disabled} onComplete={onComplete} />;
  if (kind === 'SIGNATURE') return <SignatureStep disabled={disabled} ticketId={ticketId} onComplete={onComplete} />;
  if (kind === 'FORM') return <FormStep disabled={disabled} onComplete={onComplete} />;
  return <ConfirmStep disabled={disabled} onComplete={onComplete} />;
}
