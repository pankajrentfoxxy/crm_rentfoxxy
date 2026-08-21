import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, BlockedReason, PageHeader, WizardRail } from '../../../components/ui/supportPrimitives';
import { createTicket, fetchQueueMeta, fetchTaxonomyTree, getCustomerAssets, getCustomerContext } from '../supportV2Api';
import { SUPPORT_V2_BASE } from '../supportV2Utils';
import { EMPTY_TICKET_DRAFT } from '../ticketDraft';
import { useAuth } from '../../../context/AuthContext';
import StepCustomer, { customerStepValid } from '../components/wizard/StepCustomer';
import StepMachines, { machinesStepValid } from '../components/wizard/StepMachines';
import StepClassify, { classifyStepValid } from '../components/wizard/StepClassify';
import StepConfirm from '../components/wizard/StepConfirm';

const STEPS = ['Customer & contact', 'Machines & location', 'Issue & evidence', 'Assign & review'];

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

function blockedReason(state) {
  if (state.step === 0 && !customerStepValid(state)) return 'Select a customer and a valid 10-digit mobile to continue.';
  if (state.step === 1 && !machinesStepValid(state)) return 'Search and select a machine, or mark it as not listed.';
  if (state.step === 2 && !classifyStepValid(state)) return 'Classify every machine. Add a photo, or choose Skip, to continue.';
  return '';
}

export default function NewTicketPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState(EMPTY_TICKET_DRAFT);
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

  const photoCount = (state.lines || []).reduce((n, l) => n + (l.attachment_ids || []).length, 0);

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

  const payloadFromState = () => ({
    ticket_class: state.ticket_class,
    channel: state.channel,
    customer_id: state.customer_id,
    site_id: state.site_id,
    site_key: state.site_key || undefined,
    site_pincode: state.site_pincode || undefined,
    site_label: state.site_label,
    site_source: state.site_source,
    site_dc_number: state.site_dc_number || undefined,
    site_override_reason: state.site_override_reason || undefined,
    contact_name: state.contact_name,
    contact_phone: state.contact_phone,
    contact_email: state.contact_email,
    contact_source: state.contact_source,
    contact_is_vip: state.contact_is_vip,
    subject: state.subject || undefined,
    assignment_group_id: state.assignment_group_id,
    assigned_to: state.assigned_to,
    internal_note: state.internal_note,
    photos_deferred: (state.lines || []).some((l) => l.photos_deferred),
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
      photos_required: Boolean(l.requires_photo || l.chargeable_default),
      photos_deferred: Boolean(l.photos_deferred),
    })),
    link: state.link || undefined,
  });

  const submit = async (continueToWo) => {
    setSaving(true);
    try {
      const r = await createTicket(payloadFromState());
      toast.success(`Created ${r.data.ticket_number}`);
      if (continueToWo) nav(`${SUPPORT_V2_BASE}/tickets/${r.data.ticket_id}?wo=1`);
      else nav(`${SUPPORT_V2_BASE}/tickets/${r.data.ticket_id}`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not create ticket');
    } finally {
      setSaving(false);
    }
  };

  const cust = state.customer;
  const headerBits = cust
    ? [cust.display_name || cust.company_name || cust.name, `#${cust.customer_id}`, context?.support_tier, context?.fleet_size != null ? `${context.fleet_size} machines` : null].filter(Boolean).join(' · ')
    : 'Classify every machine before the ticket exists.';

  return (
    <div className="space-y-4">
      <PageHeader title="New ticket" subtitle={headerBits} />
      <WizardRail steps={STEPS} current={state.step} onGo={(i) => setState((s) => ({ ...s, step: i }))} photoCount={photoCount} />
      {state.step === 0 && <StepCustomer state={state} setState={setState} context={context} />}
      {state.step === 1 && <StepMachines state={state} setState={setState} assets={assets} />}
      {state.step === 2 && (
        <StepClassify state={state} setState={setState} tree={tree} supportTier={context?.support_tier} fleetSize={context?.fleet_size} />
      )}
      {state.step === 3 && (
        <StepConfirm
          state={state}
          setState={setState}
          groups={groups}
          owners={owners}
          supportTier={context?.support_tier}
          fleetSize={context?.fleet_size}
          currentUserId={user?.user_id}
        />
      )}
      <div className="flex justify-between items-center gap-3">
        <Button variant="secondary" disabled={state.step === 0} onClick={() => setState((s) => ({ ...s, step: s.step - 1 }))}>Back</Button>
        <div className="flex items-center gap-3">
          <BlockedReason>{!canContinue ? blockedReason(state) : ''}</BlockedReason>
          {state.step < 3 ? (
            <Button disabled={!canContinue} onClick={goNext}>Continue</Button>
          ) : (
            <>
              <Button variant="secondary" loading={saving} onClick={() => submit(false)}>Create ticket</Button>
              <Button loading={saving} onClick={() => submit(true)}>Create ticket and continue to work order</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
