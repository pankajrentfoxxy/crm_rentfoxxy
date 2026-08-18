import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, PageHeader } from '../../../components/ui/supportPrimitives';
import { createTicket, fetchQueueMeta, fetchTaxonomyTree, getCustomerAssets, getCustomerContext } from '../supportV2Api';
import { SUPPORT_V2_BASE } from '../supportV2Utils';
import StepCustomer, { customerStepValid } from '../components/wizard/StepCustomer';
import StepMachines, { machinesStepValid } from '../components/wizard/StepMachines';
import StepClassify, { classifyStepValid } from '../components/wizard/StepClassify';
import StepConfirm from '../components/wizard/StepConfirm';

const STEPS = ['Customer', 'Machines', 'Classify', 'Confirm'];

const empty = {
  step: 0,
  ticket_class: 'INCIDENT',
  channel: 'PHONE',
  customer_id: null,
  customer: null,
  site_id: null,
  site_key: '',
  site_pincode: '',
  site_label: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  contact_is_vip: false,
  subject: '',
  selectedSerials: [],
  unknownAsset: false,
  lines: [],
  sameIssue: false,
  assignment_group_id: null,
  assigned_to: null,
  preferred_slot_start: '',
  preferred_slot_end: '',
  internal_note: '',
  link: null,
  contextSites: [],
};

function buildLines(state, assets) {
  if (state.unknownAsset && !state.selectedSerials.length) {
    return [{
      line_code: 'A1',
      asset_unknown: true,
      serial_id: null,
      ttspl_id: null,
      model: 'Unknown asset',
      impact: 2,
      urgency: 2,
      reported_description: '',
      attachment_ids: [],
    }];
  }
  return state.selectedSerials.map((id, i) => {
    const a = assets.find((x) => x.serial_id === id) || {};
    return {
      line_code: `A${i + 1}`,
      serial_id: id,
      ttspl_id: a.ttspl_id,
      serial_number: a.serial_number,
      model: [a.brand, a.model].filter(Boolean).join(' '),
      impact: 2,
      urgency: 2,
      reported_description: '',
      attachment_ids: [],
    };
  });
}

export default function NewTicketPage() {
  const nav = useNavigate();
  const [state, setState] = useState(empty);
  const [context, setContext] = useState(null);
  const [assets, setAssets] = useState([]);
  const [tree, setTree] = useState([]);
  const [groups, setGroups] = useState([]);
  const [owners, setOwners] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTaxonomyTree().then((r) => setTree(r.data?.tree || [])).catch(() => setTree([]));
    fetchQueueMeta().then((r) => {
      setGroups(r.data?.groups || []);
      setOwners(r.data?.owners || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!state.customer_id) { setContext(null); setAssets([]); return undefined; }
    getCustomerContext(state.customer_id)
      .then((r) => {
        setContext(r.data?.context || null);
        setState((s) => ({ ...s, contextSites: r.data?.context?.sites || [] }));
      })
      .catch(() => setContext(null));
    getCustomerAssets(state.customer_id)
      .then((r) => setAssets(r.data?.rows || []))
      .catch(() => setAssets([]));
    return undefined;
  }, [state.customer_id]);

  const canContinue = useMemo(() => {
    if (state.step === 0) return customerStepValid(state);
    if (state.step === 1) return machinesStepValid(state);
    if (state.step === 2) return classifyStepValid(state);
    return true;
  }, [state]);

  const goNext = () => {
    if (state.step === 1) {
      setState((s) => {
        const next = buildLines(s, assets);
        const same = s.lines.length === next.length
          && next.every((l, i) => l.serial_id === s.lines[i].serial_id && Boolean(l.asset_unknown) === Boolean(s.lines[i].asset_unknown));
        return { ...s, step: 2, lines: same && s.lines.length ? s.lines : next };
      });
      return;
    }
    setState((s) => ({ ...s, step: s.step + 1 }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        ticket_class: state.ticket_class,
        channel: state.channel,
        customer_id: state.customer_id,
        site_id: state.site_id,
        site_key: state.site_key || undefined,
        site_pincode: state.site_pincode || undefined,
        site_label: state.site_label,
        contact_name: state.contact_name,
        contact_phone: state.contact_phone,
        contact_email: state.contact_email,
        contact_is_vip: state.contact_is_vip,
        subject: state.subject || undefined,
        assignment_group_id: state.assignment_group_id,
        assigned_to: state.assigned_to,
        preferred_slot_start: state.preferred_slot_start ? new Date(state.preferred_slot_start).toISOString() : null,
        preferred_slot_end: state.preferred_slot_end ? new Date(state.preferred_slot_end).toISOString() : null,
        internal_note: state.internal_note,
        asset_lines: state.lines.map((l) => ({
          serial_id: l.serial_id,
          ttspl_id: l.ttspl_id,
          serial_number: l.serial_number,
          asset_unknown: Boolean(l.asset_unknown),
          reported_issue_id: l.reported_issue_id,
          reported_description: l.reported_description,
          impact: l.impact,
          urgency: l.urgency,
          attachment_ids: l.attachment_ids || [],
        })),
        link: state.link || undefined,
      };
      const r = await createTicket(payload);
      toast.success(`Created ${r.data.ticket_number}`);
      nav(`${SUPPORT_V2_BASE}/tickets/${r.data.ticket_id}`);
    } catch (e) {
      const msg = e.response?.data?.message || 'Could not create ticket';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="New ticket" subtitle="Classify every machine before the ticket exists." />
      <div className="flex gap-2 text-[12px]">
        {STEPS.map((label, i) => (
          <span key={label} className={`px-2 py-1 rounded ${i === state.step ? 'bg-sup-accentSoft text-sup-accent font-semibold' : 'text-sup-muted'}`}>
            {i + 1}. {label}
          </span>
        ))}
      </div>
      {state.step === 0 && <StepCustomer state={state} setState={setState} context={context} />}
      {state.step === 1 && <StepMachines state={state} setState={setState} assets={assets} />}
      {state.step === 2 && (
        <StepClassify
          state={state}
          setState={setState}
          tree={tree}
          supportTier={context?.support_tier}
          fleetSize={context?.fleet_size}
        />
      )}
      {state.step === 3 && (
        <StepConfirm
          state={state}
          setState={setState}
          groups={groups}
          owners={owners}
          supportTier={context?.support_tier}
          fleetSize={context?.fleet_size}
        />
      )}
      <div className="flex justify-between">
        <Button variant="secondary" disabled={state.step === 0} onClick={() => setState((s) => ({ ...s, step: s.step - 1 }))}>
          Back
        </Button>
        {state.step < 3 ? (
          <Button disabled={!canContinue} onClick={goNext}>Continue</Button>
        ) : (
          <Button loading={saving} onClick={submit}>Create ticket</Button>
        )}
      </div>
    </div>
  );
}
