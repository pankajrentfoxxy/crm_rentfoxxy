import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal, Mono } from '../../../components/ui/supportPrimitives';
import {
  fetchReplacementCandidates, fetchReplacementContext, createReplacement,
} from '../supportV2Api';

const REASONS = [
  { value: 'FAULTY_IRREPARABLE', label: 'Faulty, irreparable', blurb: 'The unit cannot be repaired. We deliver a replacement and collect the old one if it is still on site.' },
  { value: 'REPAIR_TOO_LONG', label: 'Repair taking too long', blurb: 'The old unit is already in our warehouse, so only a delivery job is created.' },
  { value: 'UPGRADE_DOWNGRADE', label: 'Upgrade / downgrade', blurb: 'Config or rate changes. Sales must approve the new rate before the jobs leave draft.' },
  { value: 'WRONG_UNIT_DELIVERED', label: 'Wrong unit delivered', blurb: 'No charge. We log an internal quality event and swap the machine.' },
  { value: 'RESEND_AFTER_RETURN', label: 'Resend after return', blurb: 'The old unit is already back. Only a delivery job is created.' },
];

function whatHappens(reason, collect) {
  if (reason === 'REPAIR_TOO_LONG' || reason === 'RESEND_AFTER_RETURN' || !collect) {
    return 'The old unit is already in our warehouse, so only a delivery job is created.';
  }
  return 'The old unit is with the customer, so this creates two jobs: deliver the new unit and collect the old one, both for the same technician on the same visit.';
}

export default function InitiateReplacementModal({ line, ticket, onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState('');
  const [ctx, setCtx] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [picked, setPicked] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchReplacementContext(line.line_id)
      .then((r) => setCtx(r.data))
      .catch(() => setCtx(null));
  }, [line.line_id]);

  const collect = ctx?.collect_by_reason?.[reason] ?? ctx?.needs_collect_leg;

  const loadCandidates = async () => {
    try {
      const r = await fetchReplacementCandidates(line.line_id);
      setCandidates(r.data?.candidates || []);
    } catch {
      toast.error('Could not load candidates');
    }
    setStep(2);
  };

  const submit = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const r = await createReplacement(line.line_id, {
        reason,
        new_serial_id: picked.serial_id,
        source: picked.source,
        rate: picked.rate,
      });
      const n = r.data.collect ? 2 : 1;
      toast.success(r.data.hold_as_draft ? `Held for approval · ${n} draft job(s)` : `Created ${n} work order(s)`);
      onCreated(r.data);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not start replacement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Initiate replacement"
      subtitle={ticket?.ticket_number}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {step === 0 && <Button disabled={!reason} onClick={() => setStep(1)}>Continue</Button>}
          {step === 1 && <Button onClick={loadCandidates}>Pick a unit</Button>}
          {step === 2 && <Button disabled={!picked} loading={saving} onClick={submit}>Create replacement</Button>}
        </>
      )}
    >
      {step === 0 && (
        <div className="grid gap-2">
          {REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setReason(r.value)}
              className={`text-left rounded-[10px] border p-3 ${reason === r.value ? 'ring-2 ring-sup-accent bg-sup-accentSoft' : 'border-sup-line'}`}
            >
              <div className="font-semibold text-[13px]">{r.label}</div>
              <div className="text-[12px] text-sup-muted">{r.blurb}</div>
            </button>
          ))}
        </div>
      )}
      {step === 1 && (
        <div className="space-y-2 text-[13px]">
          <p>{whatHappens(reason, collect)}</p>
          {ctx?.thresholds?.manager_value && (
            <p className="text-pri2">Unit value exceeds ₹40,000 — a support manager must approve before the jobs leave draft.</p>
          )}
          {ctx?.thresholds?.manager_frequency && (
            <p className="text-pri2">This customer already has {ctx.thresholds.replacements_90d} replacement(s) in 90 days — manager approval required.</p>
          )}
          {reason === 'UPGRADE_DOWNGRADE' && (
            <p className="text-pri2">A rate change needs Sales approval. The sales order line will be amended, not duplicated.</p>
          )}
        </div>
      )}
      {step === 2 && (
        <div className="space-y-2 max-h-[360px] overflow-y-auto">
          {candidates.map((c) => {
            const down = (c.downgrade_fields || []).length > 0;
            return (
              <button
                key={c.serial_id}
                type="button"
                onClick={() => setPicked(c)}
                className={`w-full text-left rounded-[10px] border p-2.5 ${picked?.serial_id === c.serial_id ? 'ring-2 ring-sup-accent' : 'border-sup-line'}`}
              >
                <div className="flex justify-between gap-2 text-[12px]">
                  <Mono bold>{c.ttspl_id}</Mono>
                  <span className="font-mono">{c.config_match_score}/100</span>
                </div>
                <div className="text-[12px]">{c.brand} {c.model} · {c.config || '—'}</div>
                <div className="text-[11px] text-sup-muted">
                  {c.source === 'BUFFER_ON_SITE' ? 'Buffer at site' : c.location} · ₹{Number(c.rate || 0).toLocaleString('en-IN')}
                </div>
                {down && (
                  <div className="mt-1 text-[11px] text-pri2 bg-pri2-bg rounded px-1.5 py-0.5">
                    Downgrade: {(c.downgrade_fields || []).join(', ')}
                  </div>
                )}
              </button>
            );
          })}
          {!candidates.length && <p className="text-[12px] text-sup-muted">No matching stock.</p>}
        </div>
      )}
    </Modal>
  );
}
