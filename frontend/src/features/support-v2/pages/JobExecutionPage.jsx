import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, Modal, Mono, ProgressSegments, SerialScanInput, StatusPill } from '../../../components/ui/supportPrimitives';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import {
  acceptWorkOrder, assignWorkOrder, completeWorkOrder, enRouteWorkOrder, failWorkOrder,
  fetchQueueMeta, getWorkOrder, onSiteWorkOrder, requestOtpBypass, resendWoOtp,
  startWorkOrder, verifyWoOtp,
} from '../supportV2Api';
import { LABELS, newIdempotencyKey, woTypeLabel } from '../supportV2Utils';
import { enqueueOffline } from '../offlineQueue';
import { StepBody } from '../components/steps/StepRenderers';
import OfflineBanner from '../components/OfflineBanner';
import RequestPartSheet from '../components/RequestPartSheet';
import { matchesAsset } from '../assetMatch';

function isPrevDone(steps, index) {
  if (index === 0) return true;
  return steps.slice(0, index).every((s) => s.status === 'DONE' || !s.is_mandatory);
}

async function postMaybeOffline(url, body, offlineSafe = true) {
  const key = newIdempotencyKey();
  if (!navigator.onLine) {
    if (!offlineSafe) throw new Error('Needs signal');
    await enqueueOffline({ url, method: 'POST', body, idempotencyKey: key });
    return { offline: true };
  }
  return api.post(url, body, { headers: { 'Idempotency-Key': key } });
}

export default function JobExecutionPage() {
  const { woId } = useParams();
  const { user } = usePermission();
  const [data, setData] = useState(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [partOpen, setPartOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [failForm, setFailForm] = useState({ failure_reason: 'CUSTOMER_UNAVAILABLE', notes: '', create_retry: true });
  const [form, setForm] = useState({ found_issue_id: '', notes: '', outcome: 'RESOLVED', action_code_ids: [], time_spent_minutes: '' });
  const [scan, setScan] = useState('');
  const [scanErr, setScanErr] = useState(null);
  const [otp, setOtp] = useState('');
  const [assetIdx, setAssetIdx] = useState(0);
  const [owners, setOwners] = useState([]);
  const [assignTech, setAssignTech] = useState('');

  const load = useCallback(() => {
    getWorkOrder(woId).then((r) => setData(r.data)).catch(() => toast.error('Job not found'));
  }, [woId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchQueueMeta().then((r) => setOwners(r.data?.owners || [])).catch(() => {});
  }, []);

  const w = data?.wo;
  const assets = data?.assets || [];
  const ticket = data?.ticket || {};
  const asset = assets[assetIdx] || assets[0];
  const steps = useMemo(() => {
    const raw = data?.steps || [];
    const codes = [];
    const grouped = [];
    for (const s of raw) {
      if (s.per_asset) {
        if (!codes.includes(s.step_code)) {
          codes.push(s.step_code);
          grouped.push({
            ...s,
            children: raw.filter((x) => x.step_code === s.step_code),
            status: raw.filter((x) => x.step_code === s.step_code).every((x) => x.status === 'DONE') ? 'DONE' : s.status,
          });
        }
      } else grouped.push(s);
    }
    return grouped;
  }, [data]);

  if (!w) return <p className="p-4 text-sm text-sup-muted">Loading…</p>;

  const mine = Number(w.assigned_to) === Number(user?.user_id);
  const mandatory = steps.filter((s) => s.is_mandatory);
  const doneCount = mandatory.filter((s) => s.status === 'DONE').length;
  const openStep = steps.findIndex((s, i) => s.status !== 'DONE' && isPrevDone(steps, i));
  const current = steps[openStep] || null;
  const issuePath = [asset?.reported_type_name, asset?.reported_subtype_name, asset?.reported_issue_name].filter(Boolean).join(' › ');

  const act = async (fn, ok) => {
    try { await fn(); toast.success(ok); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
  };

  const finishStep = async (step, payload) => {
    try {
      const r = await postMaybeOffline(
        `/support/v2/work-orders/${w.wo_id}/steps/${step.step_code}`,
        { ...payload, line_id: step.line_id || payload?.line_id },
        step.offline_safe !== false
      );
      if (r?.offline) toast.success('Saved offline · will sync');
      else toast.success(`${step.step_label} done`);
      setScanErr(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Step failed');
    }
  };

  const submitScan = (step) => {
    const target = step.line_id ? assets.find((a) => a.line_id === step.line_id) : asset;
    if (matchesAsset(scan, target)) {
      finishStep(step, { scanned_value: scan, expected_value: target?.ttspl_id, line_id: target?.line_id });
      setScan('');
      return;
    }
    setScanErr({ scanned: scan, expected: target });
  };

  const nextTransition = () => {
    if (w.status === 'ASSIGNED') return { label: 'Accept job', fn: () => acceptWorkOrder(w.wo_id) };
    if (w.status === 'ACCEPTED') return { label: 'En route', fn: () => enRouteWorkOrder(w.wo_id) };
    if (w.status === 'EN_ROUTE') return { label: 'On site', fn: () => onSiteWorkOrder(w.wo_id) };
    if (w.status === 'ON_SITE') return { label: 'Start work', fn: () => startWorkOrder(w.wo_id) };
    return null;
  };
  const gate = nextTransition();

  return (
    <div className="max-w-lg mx-auto min-h-screen bg-sup-canvas pb-24">
      <header className="sticky top-0 z-10 bg-white border-b border-sup-line px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <Mono bold>{w.wo_number}</Mono>
          <span className="uppercase text-sup-muted">{woTypeLabel(w.wo_type)}</span>
          <StatusPill status={`P${ticket.priority || w.priority || ''}`} />
        </div>
        <ProgressSegments total={mandatory.length} current={doneCount} />
        <p className="text-[12px] text-sup-ink">
          Step {Math.min(doneCount + 1, mandatory.length)} of {mandatory.length}
          {current ? ` · ${LABELS.STEPS[current.step_code] || current.step_label}` : ' · Complete'}
        </p>
        {assets.length > 1 ? (
          <div className="flex gap-1 overflow-x-auto">
            {assets.map((a, i) => (
              <button
                key={a.line_id}
                type="button"
                onClick={() => setAssetIdx(i)}
                className={`shrink-0 px-2 py-1 rounded-full text-[11px] ${i === assetIdx ? 'bg-sup-accent2 text-white' : 'bg-sup-lineSoft'}`}
              >
                {a.ttspl_id || a.serial_number}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-sup-muted truncate">
            {asset?.ttspl_id || '—'} · {asset?.model || '—'} · {asset?.assigned_employee || ticket.contact_name || '—'}
          </p>
        )}
      </header>

      <div className="p-3 space-y-3">
        <OfflineBanner />
        <details open className="rounded-lg border border-sup-line bg-white p-3">
          <summary className="font-semibold text-[13px] cursor-pointer">What you are going to fix</summary>
          <p className="mt-2 text-[13px] font-medium">{issuePath || 'Issue not classified'}</p>
          <p className="text-[13px] text-sup-ink mt-1">{asset?.reported_description || ticket.internal_note || 'No customer description.'}</p>
          <p className="text-[11px] text-sup-muted mt-1">— {ticket.contact_name || 'Customer'}, {ticket.customer_name}</p>
          {(data.history || []).length > 0 && (
            <p className="mt-2 text-[12px] text-pri1">
              Repeat — last closed {data.history[0].wo_number} ({data.history[0].wo_type}).
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
            <a className="underline" href={`https://maps.google.com/?q=${encodeURIComponent(ticket.site_label || '')}`}>Navigate</a>
            {ticket.contact_phone && <a className="underline" href={`tel:${ticket.contact_phone}`}>Call</a>}
          </div>
        </details>

        {(w.status === 'PENDING_ASSIGNMENT' || !w.assigned_to) && (
          <div className="rounded-lg border border-sup-line bg-white p-3 space-y-2">
            <p className="text-[13px] font-semibold">Assign technician</p>
            <select
              value={assignTech}
              onChange={(e) => setAssignTech(e.target.value)}
              className="w-full border rounded px-2 py-2 text-[13px]"
            >
              <option value="">Pick technician</option>
              {owners.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.name}</option>
              ))}
            </select>
            <Button
              className="w-full min-h-[44px]"
              disabled={!assignTech}
              onClick={() => act(
                () => assignWorkOrder(w.wo_id, { user_id: Number(assignTech) }),
                'Technician assigned'
              )}
            >
              Assign
            </Button>
          </div>
        )}

        {gate && mine && (
          <Button className="w-full min-h-[44px]" onClick={() => act(gate.fn, gate.label)}>
            {gate.label}
          </Button>
        )}

        {steps.map((step, i) => {
          const locked = !isPrevDone(steps, i);
          const currentCard = i === openStep;
          const done = step.status === 'DONE';
          return (
            <section
              key={`${step.step_code}-${step.line_id || 0}`}
              className={`rounded-lg border p-3 ${done ? 'border-sup-ok bg-sup-okBg/40' : currentCard ? 'border-sup-accent bg-white shadow-sm' : 'border-sup-lineSoft text-sup-faint'}`}
            >
              <div className="flex justify-between text-[13px] font-medium">
                <span>{done ? '✓ ' : ''}{LABELS.STEPS[step.step_code] || step.step_label}</span>
                {step.children && <span>{step.children.filter((c) => c.status === 'DONE').length} of {step.children.length}</span>}
              </div>
              {locked && !done && <p className="text-[12px] mt-1">Complete “{steps[i - 1]?.step_label}” first</p>}
              {currentCard && !done && step.help_text && <p className="text-[12px] text-sup-muted mt-1">{step.help_text}</p>}
              {currentCard && !done && step.offline_safe === false && !navigator.onLine && (
                <p className="text-[12px] text-pri1 mt-1">Needs signal</p>
              )}
              {currentCard && !done && step.step_kind === 'SCAN' && (
                <div className="mt-2 space-y-2">
                  <p className="text-[12px]">{asset?.model} · {asset?.assigned_employee || '—'}</p>
                  <SerialScanInput value={scan} onChange={setScan} onSubmit={() => submitScan(step)} />
                  {scanErr && (
                    <div className="text-[12px] bg-pri1/10 p-2 rounded">
                      <p className="font-semibold">This is a different machine.</p>
                      <p>You scanned `{scanErr.scanned}`. This job is for `{scanErr.expected?.ttspl_id}` ({scanErr.expected?.model}).</p>
                    </div>
                  )}
                </div>
              )}
              {currentCard && !done && step.step_kind === 'OTP' && (
                <div className="mt-2 space-y-2">
                  <p className="text-[12px]">Code sent to {ticket.contact_name} {w.otp_sent_to} · expires in 15 min</p>
                  <input className="w-full min-h-[44px] border rounded-md px-3 tracking-[0.4em] text-center" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
                  <Button className="w-full" onClick={() => act(() => verifyWoOtp(w.wo_id, { otp }), 'Verified')}>Verify code</Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => act(() => resendWoOtp(w.wo_id), 'Resent')}>Resend</Button>
                    <Button variant="ghost" onClick={() => {
                      const reason = window.prompt('Why can the customer not share the code?');
                      if (reason) act(() => requestOtpBypass(w.wo_id, reason), 'Bypass requested');
                    }}>Didn&apos;t get it?</Button>
                  </div>
                </div>
              )}
              {currentCard && !done && step.step_kind !== 'SCAN' && step.step_kind !== 'OTP' && (
                <div className="mt-2">
                  <StepBody step={step} wo={w} assets={assets} expected={asset?.ttspl_id} onComplete={(p) => finishStep(step, p)} />
                </div>
              )}
              {step.children && (
                <ul className="mt-2 space-y-1 text-[12px]">
                  {step.children.map((c) => {
                    const a = assets.find((x) => x.line_id === c.line_id);
                    return (
                      <li key={c.step_id || `${c.step_code}-${c.line_id}`}>
                        {c.status === 'DONE' ? '✓' : '○'} {a?.ttspl_id || a?.serial_number} · {a?.model || ''}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        {mine && ['IN_PROGRESS', 'ON_SITE'].includes(w.status) && (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={doneCount < mandatory.length} onClick={() => setCompleteOpen(true)}>Complete job</Button>
            <Button variant="ghost" onClick={() => setFailOpen(true)}>Fail visit</Button>
          </div>
        )}
      </div>

      <footer className="fixed bottom-0 inset-x-0 max-w-lg mx-auto bg-white border-t border-sup-line p-2">
        <Button className="w-full min-h-[44px]" variant="ghost" onClick={() => setPartOpen(true)}>Request a part</Button>
      </footer>

      {partOpen && <RequestPartSheet wo={w} assets={assets} onClose={() => { setPartOpen(false); load(); }} />}

      <Modal open={failOpen} onClose={() => setFailOpen(false)} title="Fail this visit">
        <select className="w-full border rounded p-2 mb-2" value={failForm.failure_reason} onChange={(e) => setFailForm({ ...failForm, failure_reason: e.target.value })}>
          <option value="CUSTOMER_UNAVAILABLE">Customer unavailable</option>
          <option value="WRONG_ADDRESS">Wrong address</option>
          <option value="ACCESS_DENIED">Access denied</option>
          <option value="MACHINE_NOT_FOUND">Machine not found</option>
          <option value="OTHER">Other</option>
        </select>
        <textarea className="w-full border rounded p-2 mb-2" placeholder="What happened" value={failForm.notes} onChange={(e) => setFailForm({ ...failForm, notes: e.target.value })} />
        <Button onClick={() => act(() => failWorkOrder(w.wo_id, failForm), 'Visit failed').then(() => setFailOpen(false))}>Submit</Button>
      </Modal>

      <Modal open={completeOpen} onClose={() => setCompleteOpen(false)} title="Complete job">
        <textarea className="w-full border rounded p-2 mb-2" placeholder="What did you do? (20+ characters)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <p className="text-[11px] text-sup-muted mb-2">{form.notes.length} / 20</p>
        <div className="flex gap-2 mb-3">
          {['RESOLVED', 'PARTIALLY_RESOLVED', 'UNRESOLVED'].map((o) => (
            <button key={o} type="button" onClick={() => setForm({ ...form, outcome: o })} className={`px-2 py-1 rounded text-[12px] ${form.outcome === o ? 'bg-sup-accent2 text-white' : 'bg-sup-lineSoft'}`}>{o.replace(/_/g, ' ')}</button>
          ))}
        </div>
        <Button disabled={form.notes.length < 20} onClick={() => act(() => completeWorkOrder(w.wo_id, form), 'Completed').then(() => setCompleteOpen(false))}>Complete</Button>
      </Modal>
    </div>
  );
}
