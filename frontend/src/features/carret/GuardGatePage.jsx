import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import GateShell from '../../shells/GateShell';
import {
  Button, ConfirmDialog, DocNumber, EmptyState, Notice, StatusChip,
} from '../../components/carret';
import api from '../../utils/api';
import {
  cancelGateSession, confirmGateSession, getGateSession, recordGateReplacement, resolveGateScan, scanGateUnit,
  unscanGateUnit,
} from '../guard-gate/guardGateApi';
import { useChallans } from './useDeliveryChallans';

/**
 * The Guard Gate (Part 3.7, Decision 4) — on the real gate sessions.
 *
 * The guard scans the challan's QR (or its number), which opens a session on
 * the server; scanning the challan verifies its laptops, and any laptop scanned
 * after that is checked individually (TTSPL, serial, configuration, direction).
 * Confirm is what moves stock: outward, the challan and its laptops go
 * dispatch_ready → in_transit and the rent clock starts; inward, a refused
 * delivery is logged at the gate so the warehouse can receive it.
 *
 * The pre-flight is shown before the guard scans anything, and a refusal at
 * confirm lists what failed instead of "unable to confirm".
 *
 * Vendor repair INWARD (require_unit_scan): nothing is pre-ticked — the guard
 * scans only the laptops that arrived and submits; the rest stay at the vendor.
 * A laptop not on the DC can be recorded as the vendor's replacement for one
 * still out. Before submit the guard can Remove a ticked laptop or Discard the
 * whole open scan (both kept on the server for audit).
 *
 * The scanner holds focus. A guard with a wedge scanner has no mouse.
 */
const looksLikeDocument = (v) => /RFXG1\|/i.test(v) || /^(G?DC|RDC|SDC|VRTDC|VRDC|GRN|SO|POUT)[/-]/i.test(v);
const CHECK_LABEL = { ttspl: 'TTSPL', serial_number: 'Serial', configuration: 'Configuration', movement_mode: 'Movement' };

function Flash({ flash }) {
  if (!flash) return null;
  return (
    <Notice tone={flash.tone} title={flash.title}>
      {flash.message}
      {(flash.failures || []).length > 0 && (
        <ul className="m-0" style={{ paddingLeft: '18px', marginTop: '4px' }}>
          {flash.failures.map((f) => <li key={f.code || f.message}>{f.message}</li>)}
        </ul>
      )}
    </Notice>
  );
}

function LaptopCard({
  l, unitScanOnly, canRemove, busy, onRemove,
}) {
  const checks = l.checks ? Object.entries(l.checks) : [];
  const state = l.verified ? 'good' : (checks.some(([, c]) => c && c.ok === false) ? 'crit' : 'pending');
  return (
    <div className="c-card" style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', borderColor: state === 'good' ? 'var(--alert-good)' : state === 'crit' ? 'var(--alert-crit)' : 'var(--rule)' }}>
      <div className="flex items-center flex-wrap" style={{ gap: '10px' }}>
        <span aria-hidden="true" style={{ fontSize: 'var(--d-lg)', color: state === 'good' ? 'var(--alert-good)' : state === 'crit' ? 'var(--alert-crit)' : 'var(--ink-3)' }}>
          {state === 'good' ? '✓' : state === 'crit' ? '✕' : '○'}
        </span>
        <DocNumber value={l.ttspl || l.serial_number} />
        <span className="font-ui text-ink-3">{l.serial_number}</span>
        {l.awb_number && <span className="font-mono text-ink-3">AWB {l.awb_number}</span>}
        <span className="ml-auto font-ui" style={{ fontWeight: 600, color: state === 'good' ? 'var(--alert-good)' : state === 'crit' ? 'var(--alert-crit)' : 'var(--ink-3)' }}>
          {state === 'good' ? 'ALL GREEN' : state === 'crit' ? 'FAILED' : unitScanOnly ? 'NOT SCANNED' : 'SCAN IT'}
        </span>
        {canRemove && l.verified && (
          <Button variant="quiet" disabled={busy} onClick={() => onRemove(l)}>Remove</Button>
        )}
      </div>
      {l.replacement_scan && (
        <div className="font-ui" style={{ marginTop: '4px', fontWeight: 600, color: 'var(--alert-serious)' }}>
          Replaced by vendor: <span className="font-mono">{l.replacement_scan}</span>
        </div>
      )}
      {unitScanOnly && state === 'pending' && (
        <div className="font-ui text-ink-3" style={{ marginTop: '4px', fontSize: 'var(--d-sm)' }}>Skip it if it has not arrived — it stays at the vendor.</div>
      )}
      {l.configuration && <div className="font-ui text-ink-2" style={{ marginTop: '4px' }}>{typeof l.configuration === 'string' ? l.configuration : Object.values(l.configuration).filter(Boolean).join(' · ')}</div>}
      {checks.length > 0 && (
        <ul className="list-none p-0 m-0" style={{ marginTop: '6px', display: 'grid', gap: '2px' }}>
          {checks.map(([k, c]) => (
            <li key={k} className="font-ui" style={{ fontSize: 'var(--d-sm)', color: c?.ok === false ? 'var(--alert-crit)' : c?.ok ? 'var(--alert-good)' : 'var(--ink-3)' }}>
              {c?.ok ? '✓' : c?.ok === false ? '✕' : '○'} {CHECK_LABEL[k] || k}{c?.message ? ` — ${c.message}` : ''}
            </li>
          ))}
        </ul>
      )}
      {l.charger && (l.charger.prt_id || l.charger.adapter_label) && (
        <div className="font-mono text-ink-3" style={{ fontSize: 'var(--d-sm)', marginTop: '4px' }}>
          Charger {l.charger.prt_id || l.charger.adapter_label}{l.charger.cable_label ? ` · cable ${l.charger.cable_label}` : ''}
        </div>
      )}
    </div>
  );
}

export default function GuardGatePage() {
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState(params.get('dir') === 'inward' ? 'inward' : 'outward');
  const [session, setSession] = useState(null);
  const [pre, setPre] = useState(null);
  const [flash, setFlash] = useState(null);
  const [buffer, setBuffer] = useState('');
  const [busy, setBusy] = useState(false);
  // Vendor repair INWARD: a scanned laptop not on the DC, offered as a replacement.
  const [replacementOffer, setReplacementOffer] = useState(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const dialogOpen = useRef(false);
  const inputRef = useRef(null);
  const autoRan = useRef(false);

  const waiting = useChallans({ status: mode === 'outward' ? 'dispatch_ready' : 'rejected', movement: 'outbound', limit: 50, refreshKey: session?.status === 'confirmed' ? 1 : 0 });

  const hold = useCallback(() => { setTimeout(() => { if (!dialogOpen.current) inputRef.current?.focus(); }, 0); }, []);
  useEffect(() => { hold(); }, [hold, session]);

  const buzz = (bad) => { if (bad && window.navigator?.vibrate) window.navigator.vibrate(250); };

  const loadPreflight = (s) => {
    const ref = s?.movement?.reference_number;
    const isDc = s?.movement?.direction === 'outward' && ['dc', 'sdc'].includes(String(s?.movement?.reference_type || '').toLowerCase());
    if (!isDc || !ref) { setPre(null); return; }
    api.get(`/guard-gate/preflight/${encodeURIComponent(ref)}`).then(({ data }) => setPre(data)).catch(() => setPre(null));
  };

  const adopt = (data) => {
    if (data?.direction && data.direction !== mode) setMode(data.direction);
    setSession(data);
    loadPreflight(data);
  };

  const resolve = useCallback(async (scan) => {
    setBusy(true); setFlash(null); setReplacementOffer(null);
    try {
      const { data } = await resolveGateScan({ direction: mode, scan });
      if (data?.session_id) {
        adopt(data);
        const ready = data.can_confirm || data.all_checks_passed;
        setFlash({ tone: ready ? 'good' : 'info', title: ready ? 'Document verified' : 'Document open', message: data.message || (ready ? 'Everything matched. Submit when the laptops are at the gate.' : 'Now scan each laptop’s TTSPL or serial.') });
      } else if (data?.kind === 'direction_mismatch') {
        buzz(true);
        setFlash({ tone: 'warn', title: 'Wrong direction', message: data.message || 'Switch the gate direction and scan again.' });
      } else {
        buzz(true);
        setFlash({ tone: 'crit', title: 'Not expected here', message: data?.message || 'This document is not expected for this movement.' });
      }
    } catch (e) {
      buzz(true);
      const d = e?.response?.data;
      setFlash({ tone: 'crit', title: 'Blocked', message: d?.message || 'Could not open this document.' });
    } finally { setBusy(false); hold(); }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const scanUnit = async (scan) => {
    setBusy(true); setFlash(null);
    try {
      const { data } = await scanGateUnit(session.session_id, { scan });
      const { data: fresh } = await getGateSession(data?.session_id || session.session_id);
      adopt(fresh);
      if (data?.kind === 'replacement_candidate') {
        setReplacementOffer({ scan: data.scanned_code || scan, options: data.replacement_options || [] });
        setFlash({ tone: 'info', title: 'Not on this repair challan', message: data.message });
      } else if (data?.kind === 'verification') setFlash({ tone: 'info', title: 'Another document opened', message: data.message });
      else if (data?.valid) setFlash({ tone: 'good', title: 'Laptop verified', message: data.message || `${scan} matched.` });
      else { buzz(true); setFlash({ tone: 'crit', title: 'Blocked', message: data?.message || `${scan} did not pass.` }); }
    } catch (e) {
      buzz(true);
      setFlash({ tone: 'crit', title: 'Blocked', message: e?.response?.data?.message || `${scan} is not on this document.` });
    } finally { setBusy(false); hold(); }
  };

  const onScan = (raw) => {
    const scan = String(raw || '').trim();
    setBuffer('');
    if (!scan || busy) return;
    if (!session || looksLikeDocument(scan) || session.status === 'confirmed') resolve(scan);
    else scanUnit(scan);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const { data } = await confirmGateSession(session.session_id, {});
      const done = data.status === 'confirmed' || Number(data.remaining_count || 0) === 0;
      setFlash({ tone: 'good', title: mode === 'outward' ? 'Out of the gate' : 'Received at the gate', message: data.message || `${session.movement?.reference_number} processed.` });
      if (done) setSession((s) => (s ? { ...s, status: 'confirmed', can_confirm: false } : s));
      else { const { data: fresh } = await getGateSession(session.session_id); adopt(fresh); }
    } catch (e) {
      buzz(true);
      const d = e?.response?.data;
      setFlash({
        tone: 'crit',
        title: d?.refused ? 'The gate refused this challan' : 'Could not submit',
        message: d?.refused ? 'Nothing moved. Call the desk to fix these, then scan again:' : (d?.message || 'Try again.'),
        failures: d?.failures,
      });
      loadPreflight(session);
    } finally { setBusy(false); hold(); }
  };

  const pickReplacement = async (option) => {
    if (!session?.session_id || !replacementOffer || busy) return;
    setBusy(true);
    try {
      const { data } = await recordGateReplacement(session.session_id, { scan: replacementOffer.scan, replaces_serial_id: option.serial_id });
      adopt(data);
      setReplacementOffer(null);
      setFlash({ tone: 'good', title: 'Replacement recorded', message: data.message });
    } catch (e) {
      buzz(true);
      setFlash({ tone: 'crit', title: 'Not recorded', message: e?.response?.data?.message || 'Could not record the replacement.' });
    } finally { setBusy(false); hold(); }
  };

  // Take a laptop back out of this scan (it did not actually come through the gate).
  const removeLaptop = async (l) => {
    if (!session?.session_id || busy) return;
    setBusy(true);
    try {
      const { data } = await unscanGateUnit(session.session_id, { serial_id: l.serial_id || null, ttspl: l.ttspl || l.serial_number || '' });
      if (data?.session_id) adopt(data);
      setFlash({ tone: 'info', title: 'Removed', message: `${l.ttspl || l.serial_number} removed from this scan.` });
    } catch (e) {
      setFlash({ tone: 'crit', title: 'Not removed', message: e?.response?.data?.message || 'Could not remove the laptop.' });
    } finally { setBusy(false); hold(); }
  };

  const openDiscard = (open) => { dialogOpen.current = open; setDiscardOpen(open); if (!open) hold(); };

  // Throw away the whole open scan (wrong document / wrong laptops) and start again.
  const discard = async () => {
    if (!session?.session_id || busy) return;
    setBusy(true);
    try {
      await cancelGateSession(session.session_id, { reason: 'Discarded by guard before submit' });
      reset();
      setFlash({ tone: 'info', title: 'Scan discarded', message: 'Scan the document again and scan only the laptops that arrived.' });
    } catch (e) {
      setFlash({ tone: 'crit', title: 'Not discarded', message: e?.response?.data?.message || 'Could not discard this scan.' });
    } finally { setBusy(false); hold(); }
  };

  const reset = () => { setReplacementOffer(null); setSession(null); setPre(null); setFlash(null); setParams({}); hold(); };

  // Deep link from a challan: /carret/move/gate?dc=DC/26-27/0001
  useEffect(() => {
    const dc = params.get('dc');
    if (dc && !autoRan.current) { autoRan.current = true; resolve(dc); }
  }, [params, resolve]);

  const mv = session?.movement || {};
  const laptops = session?.laptops || [];
  const verified = laptops.filter((l) => l.verified).length;
  const confirmed = session?.status === 'confirmed';
  const open = session?.status === 'open';
  const unitScanOnly = Boolean(session?.require_unit_scan);

  return (
    <GateShell mode={mode} onModeChange={(m) => { setMode(m); reset(); }} title="Guard gate">
      <div className="c-stack" style={{ maxWidth: '64rem', margin: '0 auto' }}>
        <form onSubmit={(e) => { e.preventDefault(); onScan(buffer); }}>
          <input
            ref={inputRef}
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            onBlur={hold}
            autoFocus
            autoComplete="off"
            spellCheck="false"
            disabled={busy}
            placeholder={session && !confirmed ? 'Scan a laptop’s TTSPL or serial' : `Scan the ${mode === 'outward' ? 'challan QR' : 'refused challan'} or type its number`}
            aria-label="Scanner"
            className="w-full bg-surface-2 border-2 border-rule-2 text-ink font-mono"
            style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', minHeight: 'calc(var(--d-tap) + 8px)', fontSize: 'var(--d-lg)', borderRadius: 'var(--d-radius)' }}
          />
        </form>

        {replacementOffer && open && (
          <section className="c-card" style={{ padding: 'var(--d-pad-x)', borderColor: 'var(--alert-serious)' }}>
            <div className="font-ui text-ink" style={{ fontWeight: 600 }}>
              Vendor replacement? <span className="font-mono">{replacementOffer.scan}</span> is not on this challan.
            </div>
            <div className="font-ui text-ink-2" style={{ marginTop: '4px' }}>Pick the laptop it replaces. Only do this if the vendor says it is a replacement.</div>
            <div className="c-stack" style={{ gap: '6px', marginTop: '10px' }}>
              {replacementOffer.options.map((o) => (
                <Button key={o.serial_id || o.ttspl} disabled={busy} onClick={() => pickReplacement(o)} style={{ justifyContent: 'flex-start', textAlign: 'left' }}>
                  Replacement for <span className="font-mono" style={{ fontWeight: 600 }}>{o.ttspl}</span>
                  <span className="text-ink-3">{o.serial_number}{o.configuration ? ` · ${typeof o.configuration === 'string' ? o.configuration : Object.values(o.configuration).filter(Boolean).join(' · ')}` : ''}</span>
                </Button>
              ))}
            </div>
            <div style={{ marginTop: '8px' }}><Button variant="quiet" onClick={() => { setReplacementOffer(null); hold(); }}>Not a replacement — ignore</Button></div>
          </section>
        )}

        <Flash flash={flash} />

        {session && open && unitScanOnly && (
          <Notice tone="info">Scan only the laptops that physically arrived, then submit. Laptops you do not scan stay at the vendor.</Notice>
        )}

        {session && (
          <section className="c-card" style={{ padding: 'var(--d-pad-x)' }}>
            <div className="flex items-baseline flex-wrap" style={{ gap: '12px' }}>
              <DocNumber value={mv.reference_number} />
              <span className="font-ui text-ink-2">{mv.source_label || mv.source_type}</span>
              {mv.dc_status_label && <StatusChip status={String(mv.dc_status_label).toLowerCase().replace(/\s+/g, '_')} />}
              <span className="ml-auto font-mono tabular-nums text-ink" style={{ fontSize: 'var(--d-lg)' }}>{verified} / {laptops.length || mv.expected_count || 0}</span>
            </div>
            <div className="font-ui text-ink-2" style={{ marginTop: '6px' }}>
              {[mv.party_name, mv.so_number, mv.movement_mode && `Mode: ${mv.movement_mode}`, (mv.awb_numbers || []).length ? `AWB ${mv.awb_numbers.join(', ')}` : (mv.awb_number && `AWB ${mv.awb_number}`)].filter(Boolean).join(' · ')}
            </div>
            {mv.active === false && <div style={{ marginTop: '10px' }}><Notice tone="serious">{mv.inactive_reason || 'This document is not active at the gate.'}</Notice></div>}
          </section>
        )}

        {session && mode === 'outward' && pre && !confirmed && (
          pre.ok
            ? <Notice tone="good" title="Pre-flight clear">Dispatch QC, e-way bill and AWB are all in place.</Notice>
            : <Flash flash={{ tone: 'crit', title: 'This challan will be refused', message: 'The desk has to fix these before it can go out:', failures: pre.failures }} />
        )}

        {session && laptops.length > 0 && (
          <div className="c-stack" style={{ gap: '8px' }}>
            {laptops.map((l) => (
              <LaptopCard key={l.serial_id || l.ttspl || l.serial_number} l={l} unitScanOnly={unitScanOnly} canRemove={open} busy={busy} onRemove={removeLaptop} />
            ))}
          </div>
        )}

        {session && !confirmed && (
          <div className="flex flex-wrap" style={{ gap: '10px' }}>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={busy || !session.can_confirm}
              style={{ minHeight: 'calc(var(--d-tap) + 8px)', fontSize: 'var(--d-lg)', flex: 1 }}
            >
              {session.can_confirm
                ? (verified && verified < laptops.length ? `Submit ${verified} of ${laptops.length} ${mode.toUpperCase()}` : `Submit ${mode.toUpperCase()}`)
                : (session.block_submit_reason || 'Scan the laptops to unlock')}
            </Button>
            {open && <Button onClick={() => openDiscard(true)} disabled={busy}>Discard scan</Button>}
            <Button onClick={reset} disabled={busy}>New scan</Button>
          </div>
        )}
        <ConfirmDialog
          open={discardOpen}
          onClose={() => openDiscard(false)}
          onConfirm={discard}
          title="Discard this scan?"
          body="Nothing has been submitted. You can scan the document again."
          confirmLabel="Discard"
        />
        {confirmed && <Button variant="primary" onClick={reset} style={{ minHeight: 'calc(var(--d-tap) + 8px)' }}>Next</Button>}

        {!session && (
          <section className="c-card">
            <div className="c-card-h"><h3>{mode === 'outward' ? 'Waiting to go out' : 'Refused deliveries coming back'}</h3><span className="font-ui text-ink-3">{waiting.total}</span></div>
            {waiting.loading && <EmptyState title="Loading…" />}
            {!waiting.loading && !waiting.rows.length && <EmptyState title={mode === 'outward' ? 'Nothing is waiting at the gate' : 'No refused delivery is waiting'} />}
            <ul className="list-none p-0 m-0">
              {waiting.rows.map((r) => (
                <li key={r.dc_number} className="border-b border-rule-2">
                  <button
                    type="button"
                    className="w-full flex items-center bg-transparent border-0 cursor-pointer font-ui text-left"
                    style={{ gap: '12px', minHeight: 'var(--d-row)', padding: '0 var(--d-pad-x)', fontSize: 'var(--d-base)' }}
                    onClick={() => resolve(r.dc_number)}
                  >
                    <DocNumber value={r.dc_number} />
                    <span className="text-ink-2 truncate">{r.customer_name}</span>
                    {r.eway_required && !r.eway_bill_number && <StatusChip status="overdue" title="E-way bill missing" />}
                    <span className="ml-auto text-ink-3">{r.dispatch_mode}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </GateShell>
  );
}
