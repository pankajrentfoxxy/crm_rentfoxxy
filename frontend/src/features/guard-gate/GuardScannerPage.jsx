import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Circle,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import ScanField from '../../components/ScanField';
import { confirmGateSession, getGateSession, resolveGateScan, scanGateUnit } from './guardGateApi';

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

const CHECKS = [
  { key: 'ttspl', label: 'TTSPL' },
  { key: 'serial_number', label: 'Serial number' },
  { key: 'configuration', label: 'Laptop configuration' },
  { key: 'movement_mode', label: 'Movement mode' },
];

function CheckIcon({ status }) {
  if (status === 'pass') return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (status === 'fail') return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
  return <Circle className="w-4 h-4 text-slate-300 shrink-0" />;
}

function laptopCheckStatus(laptop, key) {
  const row = laptop?.checks?.[key];
  if (!row) return 'pending';
  return row.ok ? 'pass' : 'fail';
}

function laptopAllGreen(laptop) {
  if (laptop?.verified) return true;
  if (!laptop?.checks) return false;
  return CHECKS.every((c) => laptop.checks[c.key]?.ok);
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="text-xs text-slate-500 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-slate-900 text-right break-all">{value}</dd>
    </div>
  );
}

function looksLikeDocumentScan(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/RFXG1\|/i.test(s)) return true;
  if (/^(G?DC|RDC|SDC|VRDC|GRN|SO)[\/-]/i.test(s)) return true;
  return false;
}

function pendingCheckHint(laptop, key) {
  if (key === 'serial_number' && laptop?.serial_number) {
    return `Scan ${laptop.serial_number} or ${laptop.ttspl || 'the laptop sticker'}`;
  }
  if (key === 'configuration') {
    return laptop?.configuration
      ? 'Confirmed from inventory when the laptop sticker is scanned'
      : 'Scan the laptop sticker to confirm configuration';
  }
  if (key === 'movement_mode') {
    return 'Confirmed from this DC when the laptop sticker is scanned';
  }
  return `Scan ${laptop?.ttspl || laptop?.serial_number || 'this laptop'} to validate`;
}

function sessionDirection(data) {
  return data?.direction || data?.movement?.direction || null;
}

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

  const applySession = (data) => {
    const nextDir = sessionDirection(data);
    if (nextDir) setDirection(nextDir);
    if (data?.session_id) {
      setSession(data);
      const current = searchParams.get('session');
      if (current !== data.session_id) {
        setSearchParams({ session: data.session_id, dir: nextDir || direction }, { replace: true });
      }
    }
  };

  const runResolve = useCallback(async (scanValue) => {
    const scan = String(scanValue || '').trim();
    if (!scan || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const { data } = await resolveGateScan({ direction, scan });
      const nextDir = sessionDirection(data);
      if (nextDir) setDirection(nextDir);
      if (data?.session_id && (data?.kind === 'verification' || data?.kind === 'unit' || data?.valid)) {
        applySession(data);
        if (data?.kind === 'unit' && data?.valid && data?.all_passed !== false) {
          setFlash({
            tone: 'success',
            title: 'All checks passed',
            message: data.message || 'Laptop verified.',
          });
        } else if (data?.kind === 'unit') {
          setFlash({
            tone: 'error',
            title: 'Blocked',
            message: data.message || 'Verification failed. Submit is disabled.',
            checks: data.checks || null,
          });
        } else {
          const verified = Number(data.auto_verified || data.scanned_count || 0);
          const allOk = Boolean(data.all_checks_passed || data.can_confirm);
          setFlash({
            tone: allOk ? 'success' : 'info',
            title: allOk ? 'Verified from document' : (nextDir ? `${String(nextDir).toUpperCase()} verification` : 'Verification'),
            message: data.message || (allOk
              ? 'TTSPL, serial, and configuration matched this DC. Submit to process.'
              : 'Now scan the laptop TTSPL or serial to verify.'),
          });
        }
      } else if (data?.kind === 'direction_mismatch' && nextDir) {
        setSession(null);
        setFlash({
          tone: 'error',
          title: 'Switch direction',
          message: data?.message || `Switch the scanner to ${String(nextDir).toUpperCase()} and scan again.`,
        });
      } else {
        setSession(null);
        setFlash({
          tone: 'error',
          title: 'Blocked',
          message: data?.message || 'This document is not expected for this movement.',
        });
      }
    } catch (err) {
      setFlash({
        tone: 'error',
        title: 'Blocked',
        message: err.response?.data?.message || 'Unable to open this document.',
      });
    } finally {
      setBusy(false);
      setCode('');
    }
  }, [busy, direction]);

  const runUnitScan = useCallback(async (scanValue) => {
    const scan = String(scanValue || '').trim();
    if (!scan || !session?.session_id) return;
    if (busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const { data } = await scanGateUnit(session.session_id, { scan });
      if (data?.kind === 'verification' && data?.session_id) {
        applySession(data);
        setFlash({
          tone: 'info',
          title: 'Verification',
          message: data.message || 'Opened a new document for verification.',
        });
        return;
      }
      applySession(data);
      if (data?.valid && data?.all_passed !== false) {
        setFlash({
          tone: 'success',
          title: 'All checks passed',
          message: data.message || 'Laptop verified.',
        });
      } else {
        setFlash({
          tone: 'error',
          title: 'Blocked',
          message: data?.message || 'Verification failed. Submit is disabled.',
          checks: data?.checks || null,
        });
      }
    } catch (err) {
      setFlash({
        tone: 'error',
        title: 'Blocked',
        message: err.response?.data?.message || 'Unable to validate this laptop.',
      });
    } finally {
      setBusy(false);
      setCode('');
    }
  }, [busy, session?.session_id]);

  const handleScan = useCallback((value) => {
    if (looksLikeDocumentScan(value)) {
      runResolve(value);
      return;
    }
    if (session?.session_id && session.status === 'open') {
      runUnitScan(value);
    } else {
      runResolve(value);
    }
  }, [session, runUnitScan, runResolve]);

  const requestedRef = useRef(false);
  useEffect(() => {
    const existing = searchParams.get('session');
    const q = searchParams.get('q') || searchParams.get('t') || searchParams.get('ref');
    if (existing && !requestedRef.current && !session) {
      requestedRef.current = true;
      getGateSession(existing)
        .then(({ data }) => {
          if (data?.session_id) applySession(data);
        })
        .catch(() => {});
      return;
    }
    if (q && !requestedRef.current) {
      requestedRef.current = true;
      setSearchParams({}, { replace: true });
      runResolve(q);
    }
  }, [searchParams, setSearchParams, runResolve, session]);

  const handleConfirm = async () => {
    if (!session?.session_id || confirming || !session.can_confirm) return;
    setConfirming(true);
    try {
      const { data } = await confirmGateSession(session.session_id, {});
      if (data?.ok || data?.success) {
        const done = data.status === 'confirmed' || Number(data.remaining_count || 0) === 0;
        setFlash({
          tone: 'success',
          title: `${direction.toUpperCase()} recorded`,
          message: data.message || `Gate ${direction} processed.`,
        });
        if (done) {
          setSession((prev) => (prev ? { ...prev, status: 'confirmed', can_confirm: false } : prev));
        } else {
          try {
            const refreshed = await getGateSession(session.session_id);
            applySession(refreshed.data);
          } catch {
            setSession((prev) => (prev ? { ...prev, can_confirm: false } : prev));
          }
        }
      } else {
        applySession(data);
        setFlash({
          tone: 'error',
          title: 'Blocked',
          message: data?.message || 'Complete all checks before submitting.',
        });
      }
    } catch (err) {
      const payload = err.response?.data;
      if (payload?.session_id) applySession(payload);
      setFlash({
        tone: 'error',
        title: 'Blocked',
        message: payload?.message || 'Unable to process this movement.',
      });
    } finally {
      setConfirming(false);
    }
  };

  const reset = () => {
    setSession(null);
    setFlash(null);
    setCode('');
    setSearchParams({}, { replace: true });
  };

  const movement = session?.movement;
  const laptops = session?.laptops || [];
  const verifying = Boolean(session?.session_id);
  const allGreen = Boolean(session?.all_checks_passed) || (laptops.length > 0 && laptops.every(laptopAllGreen));
  const submitEnabled = Boolean(session?.can_confirm && session.status === 'open');

  const flashClass = {
    success: 'bg-emerald-50 text-emerald-800',
    error: 'bg-red-50 text-red-800',
    info: 'bg-sky-50 text-sky-800',
  }[flash?.tone] || 'bg-slate-50 text-slate-800';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {verifying ? 'Verification' : 'Gate scanner'}
          </h1>
          <p className="text-sm text-slate-500">
            {verifying
              ? (submitEnabled
                ? 'Document units matched. Submit to process this movement.'
                : 'Confirm laptop details. Submit stays locked until every check is green.')
              : 'Select direction, then scan a DC / Return DC / Repair DC QR'}
          </p>
        </div>
        {session ? (
          <button type="button" onClick={reset} className="text-xs font-medium text-slate-600 inline-flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5" /> New
          </button>
        ) : null}
      </div>

      {!verifying ? (
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
      ) : (
        <div className={`rounded-2xl px-4 py-3 flex items-center gap-2 ${
          direction === 'outward' ? 'bg-orange-50 text-orange-900' : 'bg-teal-50 text-teal-900'
        }`}>
          {direction === 'outward'
            ? <ArrowUpFromLine className="w-4 h-4 shrink-0" />
            : <ArrowDownToLine className="w-4 h-4 shrink-0" />}
          <p className="text-sm font-semibold">{direction.toUpperCase()} verification</p>
        </div>
      )}

      <ScanField
        value={code}
        onChange={setCode}
        onScan={handleScan}
        autoFocus
        placeholder={verifying ? 'Scan TTSPL, serial, or AWB to verify…' : 'Scan DC / Return DC / Repair DC QR'}
        disabled={busy || session?.status === 'confirmed'}
        aria-label="Gate scanner"
      />

      {flash ? (
        <div className={`rounded-2xl px-4 py-3 flex items-start gap-3 ${flashClass}`}>
          {flash.tone === 'error'
            ? <XCircle className="w-5 h-5 mt-0.5 shrink-0" />
            : flash.tone === 'success'
              ? <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
              : <ShieldCheck className="w-5 h-5 mt-0.5 shrink-0" />}
          <div>
            <p className="text-sm font-bold">{flash.title}</p>
            <p className="text-sm">{flash.message}</p>
          </div>
        </div>
      ) : null}

      {movement ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Movement details
          </p>
          <p className="text-lg font-bold text-slate-900">{movement.reference_number}</p>
          <dl className="mt-2 divide-y divide-slate-50">
            <DetailRow
              label="Type"
              value={SOURCE_LABELS[movement.source_type] || movement.source_label || movement.source_type}
            />
            <DetailRow label="Direction" value={(movement.direction || direction).toUpperCase()} />
            <DetailRow label="Movement mode" value={movement.movement_mode} />
            <DetailRow label="Party" value={movement.party_name} />
            <DetailRow label="Sales order" value={movement.so_number} />
            <DetailRow
              label="AWB"
              value={(movement.awb_numbers && movement.awb_numbers.length
                ? movement.awb_numbers.join(' · ')
                : movement.awb_number)}
            />
            <DetailRow
              label="Laptops"
              value={`${session.scanned_count || 0} / ${session.expected_count || laptops.length} verified`}
            />
          </dl>
        </div>
      ) : null}

      {laptops.length ? (
        <ul className="space-y-3">
          {laptops.map((laptop) => {
            const green = laptopAllGreen(laptop);
            const failed = CHECKS.some((c) => laptopCheckStatus(laptop, c.key) === 'fail');
            return (
              <li
                key={laptop.serial_id || laptop.ttspl || laptop.serial_number}
                className={`bg-white rounded-2xl border p-4 ${
                  green ? 'border-emerald-200' : failed ? 'border-red-200' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-semibold text-slate-900 truncate">
                      {laptop.ttspl || '—'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{laptop.serial_number || '—'}</p>
                    {laptop.awb_number ? (
                      <p className="text-[11px] font-medium text-slate-500 truncate">AWB {laptop.awb_number}</p>
                    ) : null}
                    {laptop.configuration ? (
                      <p className="text-[11px] text-slate-400 truncate">{laptop.configuration}</p>
                    ) : null}
                  </div>
                  <span className={`text-xs font-bold shrink-0 ${
                    green ? 'text-emerald-600' : failed ? 'text-red-600' : 'text-slate-400'
                  }`}>
                    {green ? 'ALL GREEN' : failed ? 'FAILED' : 'PENDING'}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {CHECKS.map(({ key, label }) => {
                    const status = laptopCheckStatus(laptop, key);
                    const row = laptop.checks?.[key];
                    return (
                      <li key={key} className="flex items-start gap-2">
                        <CheckIcon status={status} />
                        <div className="min-w-0">
                          <p className={`text-xs font-semibold ${
                            status === 'pass' ? 'text-emerald-700' : status === 'fail' ? 'text-red-700' : 'text-slate-500'
                          }`}>
                            {label}
                          </p>
                          {row?.message ? (
                            <p className="text-[11px] text-slate-500">{row.message}</p>
                          ) : status === 'pending' ? (
                            <p className="text-[11px] text-slate-400">
                              {pendingCheckHint(laptop, key)}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}

      {verifying && session.status === 'open' ? (
        <div className="space-y-2">
          <button
            type="button"
            disabled={confirming || !submitEnabled}
            onClick={handleConfirm}
            className={`w-full py-3.5 rounded-2xl font-semibold text-sm disabled:opacity-50 ${
              submitEnabled ? 'bg-teal-600 text-white' : 'bg-slate-200 text-slate-500'
            }`}
          >
            {confirming
              ? 'Processing…'
              : submitEnabled
                ? (allGreen
                  ? `Submit ${direction.toUpperCase()}`
                  : `Submit ${session.scanned_count} of ${session.expected_count} ${direction.toUpperCase()}`)
                : `Submit ${direction.toUpperCase()} (locked)`}
          </button>
          {!submitEnabled ? (
            <p className="text-center text-xs text-red-600">
              {session.block_submit_reason || 'All checks must pass before submit.'}
            </p>
          ) : allGreen ? (
            <p className="text-center text-xs text-emerald-700">
              All checks passed. Confirm to process {direction}.
            </p>
          ) : (
            <p className="text-center text-xs text-emerald-700">
              Verified laptops passed all checks. Confirm to process {direction}.
            </p>
          )}
        </div>
      ) : null}

      {session?.status === 'confirmed' ? (
        <p className="text-center text-sm font-semibold text-emerald-700">
          Gate {direction} processed.
        </p>
      ) : null}
    </div>
  );
}
