import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, PageHeader } from '../../../components/ui/primitives';
import { Mono, StatusPill, TypeTag } from '../../../components/ui/supportPrimitives';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import {
  acceptWorkOrder, completeWorkOrder, consumePartRequest, enRouteWorkOrder, failWorkOrder,
  getWorkOrder, onSiteWorkOrder, returnUnusedPart, uploadAttachments,
} from '../supportV2Api';
import { newIdempotencyKey } from '../supportV2Utils';
import { enqueueOffline } from '../offlineQueue';
import { StepBody } from '../components/steps/StepRenderers';
import OfflineBanner from '../components/OfflineBanner';
import RequestPartSheet from '../components/RequestPartSheet';
import { Modal } from '../../../components/ui/supportPrimitives';
function isPrevDone(steps, index) {
  if (index === 0) return true;
  return steps[index - 1].status === 'DONE' || !steps[index - 1].is_mandatory;
}

async function postMaybeOffline(url, body) {
  const key = newIdempotencyKey();
  if (!navigator.onLine) {
    await enqueueOffline({ url, method: 'POST', body, idempotencyKey: key });
    return { offline: true };
  }
  return api.post(url, body, { headers: { 'Idempotency-Key': key } });
}

export default function JobExecutionPage() {
  const { woId } = useParams();
  const { user, hasPermission } = usePermission();
  const [data, setData] = useState(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [partOpen, setPartOpen] = useState(false);
  const [form, setForm] = useState({ found_issue_id: '', notes: '', outcome: 'RESOLVED', action_code_ids: [], time_spent_minutes: '' });
  const [fit, setFit] = useState({ prt: '', serial: '', files: [] });

  const load = useCallback(() => {
    getWorkOrder(woId).then((r) => setData(r.data)).catch(() => toast.error('Job not found'));
  }, [woId]);
  useEffect(() => { load(); }, [load]);

  if (!data?.wo) return <p className="p-4 text-sm text-sup-muted">Loading…</p>;
  const w = data.wo;
  const steps = data.steps || [];
  const mine = Number(w.assigned_to) === Number(user?.user_id);
  const mandatory = steps.filter((s) => s.is_mandatory);
  const doneCount = mandatory.filter((s) => s.status === 'DONE').length;
  const remaining = mandatory.length - doneCount;
  const allMandatoryDone = remaining === 0;
  const expected = (data.assets || [])[0]?.ttspl_id || (data.assets || [])[0]?.serial_number;
  const openStep = steps.findIndex((s, i) => s.status !== 'DONE' && isPrevDone(steps, i));

  const act = async (fn, ok) => {
    try { await fn(); toast.success(ok); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
  };

  const finishStep = async (step, payload) => {
    try {
      const r = await postMaybeOffline(`/support/v2/work-orders/${w.wo_id}/steps/${step.step_code}`, payload);
      if (r?.offline) toast.success('Saved offline');
      else toast.success(`${step.step_label} done`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Step failed');
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-3">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/95 border-b border-sup-lineSoft backdrop-blur">
        <div className="flex items-center justify-between text-[12px]">
          <Mono bold>{w.wo_number}</Mono>
          <span>{doneCount}/{mandatory.length} steps</span>
        </div>
        <div className="h-1.5 bg-sup-canvas2 rounded-full mt-1 overflow-hidden">
          <div className="h-full bg-sup-accent" style={{ width: `${mandatory.length ? (doneCount / mandatory.length) * 100 : 0}%` }} />
        </div>
      </div>
      <PageHeader title={w.wo_number} subtitle={`${w.ticket_number} · ${w.wo_type}`} />
      <OfflineBanner />
      <div className="bg-white rounded-xl border border-sup-lineSoft p-3 flex flex-wrap items-center gap-2">
        <Mono bold className="text-[15px]">{w.wo_number}</Mono>
        <TypeTag type={w.wo_type} />
        <StatusPill kind="wo" status={w.status} />
        {w.document_number ? <Mono className="ml-auto text-[12px]">{w.document_number}</Mono> : null}
      </div>
      {mine && hasPermission('support_parts_request', 'create') && w.ticket_id && (data.assets || [])[0] && (
        <Button size="sm" variant="secondary" onClick={() => setPartOpen(true)}>Request a part</Button>
      )}
      {mine && data.part_request && ['ISSUED', 'RESERVED', 'IN_TRANSIT', 'DELIVERED'].includes(data.part_request.status_v2) && (
        <div className="bg-white rounded-xl border border-sup-lineSoft p-3 space-y-2 text-[12px]">
          <div className="font-semibold">Fit part {data.part_request.request_number}</div>
          <input placeholder="Part QR / PRT" className="w-full border rounded px-2 py-1.5" value={fit.prt}
            onChange={(e) => setFit((f) => ({ ...f, prt: e.target.value }))} />
          <input placeholder="Laptop serial / TTSPL" className="w-full border rounded px-2 py-1.5" value={fit.serial}
            onChange={(e) => setFit((f) => ({ ...f, serial: e.target.value }))} />
          <input type="file" accept="image/*" onChange={(e) => setFit((f) => ({ ...f, files: [...e.target.files] }))} />
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => {
              try {
                if (!fit.files.length) { toast.error('Fitted photo required'); return; }
                const up = await uploadAttachments(w.ticket_id, fit.files, { kind: 'PHOTO_PART' });
                const ids = (up.data?.rows || []).map((x) => x.attachment_id);
                await consumePartRequest(data.part_request.request_id, {
                  prt_id: fit.prt, asset_serial: fit.serial, photo_attachment_ids: ids,
                });
                toast.success('Part fitted');
                load();
              } catch (e) { toast.error(e.response?.data?.message || 'Consume failed'); }
            }}>Mark fitted</Button>
            <Button size="sm" variant="secondary" onClick={async () => {
              try { await returnUnusedPart(data.part_request.request_id); toast.success('Returned unused'); load(); }
              catch (e) { toast.error(e.response?.data?.message || 'Return failed'); }
            }}>Return unused</Button>
          </div>
        </div>
      )}
      {mine && (
        <div className="flex flex-wrap gap-2">
          {w.status === 'ASSIGNED' && <Button size="sm" onClick={() => act(() => acceptWorkOrder(w.wo_id, { 'Idempotency-Key': newIdempotencyKey() }), 'Accepted')}>Accept</Button>}
          {w.status === 'ACCEPTED' && !w.skips_travel && <Button size="sm" onClick={() => act(() => enRouteWorkOrder(w.wo_id, { 'Idempotency-Key': newIdempotencyKey() }), 'En route')}>En route</Button>}
          {(w.status === 'EN_ROUTE' || w.status === 'ACCEPTED') && <Button size="sm" onClick={() => act(() => onSiteWorkOrder(w.wo_id, { 'Idempotency-Key': newIdempotencyKey() }), 'On site')}>On site</Button>}
        </div>
      )}
      <div className="space-y-2">
        {steps.map((s, i) => {
          const locked = !mine || !isPrevDone(steps, i) || s.status === 'DONE';
          return (
            <div key={s.step_code} className="bg-white rounded-xl border border-sup-lineSoft p-3">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <div>
                  <span className="font-semibold">{s.step_label}</span>
                  <span className="text-sup-faint ml-2">{s.step_kind}</span>
                </div>
                <span className={s.status === 'DONE' ? 'text-sup-ok' : 'text-sup-muted'}>{s.status}</span>
              </div>
              {s.status !== 'DONE' && i === openStep && (
                <div className="mt-2">
                  <StepBody
                    step={s}
                    ticketId={w.ticket_id}
                    expected={expected}
                    disabled={locked}
                    wo={w}
                    assets={data.assets || []}
                    onComplete={(payload) => finishStep(s, payload)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button
        className="min-h-[44px] w-full"
        disabled={!mine || !allMandatoryDone || w.status === 'COMPLETED'}
        onClick={() => setCompleteOpen(true)}
      >
        {allMandatoryDone ? 'Complete job' : `${remaining} step${remaining === 1 ? '' : 's'} remaining`}
      </Button>
      {mine && w.status !== 'COMPLETED' && w.status !== 'FAILED' && (
        <Button variant="danger" size="sm" onClick={() => {
          const reason = window.prompt('Failure reason (e.g. CUSTOMER_UNAVAILABLE)');
          if (!reason) return;
          act(() => failWorkOrder(w.wo_id, { failure_reason: reason, notes: 'Failed on site', create_retry: true }, { 'Idempotency-Key': newIdempotencyKey() }), 'Failed · retry created');
        }}>Fail + retry</Button>
      )}

      {completeOpen && (
        <Modal title="Complete job" onClose={() => setCompleteOpen(false)} footer={(
          <>
            <Button variant="secondary" onClick={() => setCompleteOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              const ids = String(form.action_code_ids).split(',').map((x) => Number(x.trim())).filter(Boolean);
              act(() => completeWorkOrder(w.wo_id, {
                found_issue_id: Number(form.found_issue_id),
                action_code_ids: ids,
                notes: form.notes,
                outcome: form.outcome,
                time_spent_minutes: form.time_spent_minutes ? Number(form.time_spent_minutes) : null,
              }, { 'Idempotency-Key': newIdempotencyKey() }), 'Completed');
              setCompleteOpen(false);
            }}>Complete</Button>
          </>
        )}
        >
          <div className="space-y-2 text-[12px]">
            <input placeholder="Found issue id" value={form.found_issue_id} onChange={(e) => setForm((f) => ({ ...f, found_issue_id: e.target.value }))} className="w-full border rounded px-2 py-1.5" />
            <input placeholder="Action code ids (comma)" value={form.action_code_ids} onChange={(e) => setForm((f) => ({ ...f, action_code_ids: e.target.value }))} className="w-full border rounded px-2 py-1.5" />
            <select value={form.outcome} onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))} className="w-full border rounded px-2 py-1.5">
              <option value="RESOLVED">Resolved</option>
              <option value="NOT_RESOLVED">Not resolved</option>
              <option value="PARTIAL">Partial</option>
            </select>
            <textarea placeholder="Notes (min 20)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border rounded px-2 py-1.5" rows={3} />
          </div>
        </Modal>
      )}
      {partOpen && (
        <RequestPartSheet
          ticketId={w.ticket_id}
          line={(data.assets || [])[0]}
          onClose={() => setPartOpen(false)}
          onCreated={() => { setPartOpen(false); load(); }}
        />
      )}
    </div>
  );
}
