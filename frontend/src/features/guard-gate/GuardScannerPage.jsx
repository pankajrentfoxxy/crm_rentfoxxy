import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import ScanField from '../../components/ScanField';
import { confirmGateSession, resolveGateScan, scanGateUnit } from './guardGateApi';

const SOURCE_LABELS = {
  vendor: 'Vendor',
  customer_return: 'Customer Return',
  repair_pickup: 'Repair Pickup',
  customer_delivery: 'Customer Delivery',
  vendor_repair: 'Vendor Repair',
  replacement: 'Replacement',
  service_return: 'Service Return',
  refused_delivery: 'Refused Delivery',
};

export default function GuardScannerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [direction, setDirection] = useState(() => {
    const q = String(searchParams.get('dir') || '').toLowerCase();
    return q === 'outward' ? 'outward' : 'inward';
  });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const [session, setSession] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const applyResult = (data, fallbackInvalid) => {
    setSession(data?.session_id ? data : null);
    if (data?.valid) {
      setFlash({ ok: true, message: data.message || 'VALID' });
    } else {
      setFlash({ ok: false, message: data?.message || fallbackInvalid });
    }
  };

  const runResolve = useCallback(async (scanValue) => {
    const scan = String(scanValue || '').trim();
    if (!scan || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const { data } = await resolveGateScan({ direction, scan });
      applyResult(data, 'This laptop is not expected for this movement.');
    } catch (err) {
      setFlash({ ok: false, message: err.response?.data?.message || 'Unable to validate this scan.' });
    } finally {
      setBusy(false);
      setCode('');
    }
  }, [busy, direction]);

  const runUnitScan = useCallback(async (scanValue) => {
    const scan = String(scanValue || '').trim();
    if (!scan || busy || !session?.session_id) return;
    setBusy(true);
    setFlash(null);
    try {
      const { data } = await scanGateUnit(session.session_id, { scan });
      applyResult(data, 'This laptop is not expected for this movement.');
    } catch (err) {
      setFlash({ ok: false, message: err.response?.data?.message || 'Unable to validate this laptop.' });
    } finally {
      setBusy(false);
      setCode('');
    }
  }, [busy, session?.session_id]);

  const handleScan = useCallback((value) => {
    if (session?.session_id && session.status === 'open') {
      runUnitScan(value);
    } else {
      runResolve(value);
    }
  }, [session, runUnitScan, runResolve]);

  const requestedRef = useRef(false);
  useEffect(() => {
    const q = searchParams.get('q') || searchParams.get('t') || searchParams.get('ref');
    if (q && !requestedRef.current) {
      requestedRef.current = true;
      setSearchParams({}, { replace: true });
      runResolve(q);
    }
  }, [searchParams, setSearchParams, runResolve]);

  const handleConfirm = async () => {
    if (!session?.session_id || confirming) return;
    setConfirming(true);
    try {
      const { data } = await confirmGateSession(session.session_id, {});
      if (data?.ok || data?.success) {
        setFlash({ ok: true, message: data.message || 'Gate movement confirmed.' });
        setSession((prev) => prev ? { ...prev, status: 'confirmed', can_confirm: false } : prev);
      } else {
        setFlash({ ok: false, message: data?.message || 'Cannot confirm yet.' });
      }
    } catch (err) {
      setFlash({ ok: false, message: err.response?.data?.message || 'Unable to confirm gate movement.' });
    } finally {
      setConfirming(false);
    }
  };

  const reset = () => {
    setSession(null);
    setFlash(null);
    setCode('');
  };

  const movement = session?.movement;
  const laptops = session?.laptops || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Gate scanner</h1>
          <p className="text-sm text-slate-500">Scan QR, AWB, TTSPL or serial</p>
        </div>
        {session ? (
          <button type="button" onClick={reset} className="text-xs font-medium text-slate-600 inline-flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5" /> New
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 bg-white rounded-2xl p-1 border border-slate-200">
        {[
          { id: 'inward', label: 'INWARD', icon: ArrowDownToLine },
          { id: 'outward', label: 'OUTWARD', icon: ArrowUpFromLine },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => { setDirection(id); reset(); }}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold ${
              direction === id ? 'bg-slate-900 text-white' : 'text-slate-600'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <ScanField
        value={code}
        onChange={setCode}
        onScan={handleScan}
        autoFocus
        placeholder={session ? 'Scan TTSPL / serial…' : 'Scan QR / AWB / TTSPL / serial…'}
        disabled={busy || session?.status === 'confirmed'}
        aria-label="Gate scanner"
      />

      {flash ? (
        <div className={`rounded-2xl px-4 py-3 flex items-start gap-3 ${
          flash.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
        }`}>
          {flash.ok ? <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" /> : <XCircle className="w-5 h-5 mt-0.5 shrink-0" />}
          <div>
            <p className="text-sm font-bold">{flash.ok ? 'VALID' : 'INVALID'}</p>
            <p className="text-sm">{flash.message}</p>
          </div>
        </div>
      ) : null}

      {movement ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {SOURCE_LABELS[movement.source_type] || movement.source_label || movement.source_type}
            </p>
            <p className="text-xs font-bold text-slate-900">{(movement.direction || '').toUpperCase()}</p>
          </div>
          <p className="text-lg font-bold text-slate-900">{movement.reference_number}</p>
          {movement.party_name ? <p className="text-sm text-slate-600">{movement.party_name}</p> : null}
          {movement.so_number ? <p className="text-xs text-slate-500">SO {movement.so_number}</p> : null}
          {movement.awb_number ? <p className="text-xs text-slate-500">AWB {movement.awb_number}</p> : null}
          <div className="flex gap-3 pt-1 text-sm">
            <span className="font-semibold text-slate-900">Expected {session.expected_count}</span>
            <span className="text-teal-700 font-semibold">Scanned {session.scanned_count}</span>
            <span className="text-slate-500">Remaining {session.remaining_count}</span>
          </div>
        </div>
      ) : null}

      {laptops.length ? (
        <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-50 overflow-hidden">
          {laptops.map((laptop) => (
            <li key={laptop.serial_id || laptop.ttspl || laptop.serial_number} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-mono font-semibold text-slate-900 truncate">{laptop.ttspl || '—'}</p>
                <p className="text-xs text-slate-500 truncate">{laptop.serial_number || '—'}</p>
                {laptop.configuration ? (
                  <p className="text-[11px] text-slate-400 truncate">{laptop.configuration}</p>
                ) : null}
              </div>
              <span className={`text-xs font-bold ${laptop.scanned ? 'text-emerald-600' : 'text-slate-400'}`}>
                {laptop.scanned ? 'VALID' : 'PENDING'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {session?.can_confirm && session.status === 'open' ? (
        <button
          type="button"
          disabled={confirming}
          onClick={handleConfirm}
          className="w-full py-3.5 rounded-2xl bg-teal-600 text-white font-semibold text-sm disabled:opacity-60"
        >
          {confirming ? 'Confirming…' : `Confirm ${direction.toUpperCase()}`}
        </button>
      ) : null}

      {session?.status === 'confirmed' ? (
        <p className="text-center text-sm font-semibold text-emerald-700">Gate movement recorded.</p>
      ) : null}
    </div>
  );
}
