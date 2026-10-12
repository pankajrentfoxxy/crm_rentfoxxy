import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, EmptyState, FlowSteps, KeyValue, Notice, Section,
} from '../../../../components/carret';
import {
  createCampaign, updateCampaign, getCampaign, getCampaignConfig, apiErrorMessage,
} from '../../../whatsapp-campaigns/whatsappCampaignApi';
import { formatNumber } from '../../../whatsapp-campaigns/campaignStatus';
import { EMPTY_CAMPAIGN, validateCampaignForm } from '../../../whatsapp-campaigns/components/CampaignSettingsForm';
import CampaignForm from './CampaignForm';
import { ImportContactsPanel, ImportSummary, ContactsPanel } from './CampaignPanels';
import {
  BASE, CampaignActions, WhatsAppPreview, useCampaignPermissions,
} from './campaignShared';

/**
 * Sell → WhatsApp Campaigns → New. Six steps, as on the old screen: details,
 * template, upload, validation, preview, start. The campaign is saved as a
 * draft when the template step is done; nothing is sent until someone with
 * the "start" grant confirms on the last step.
 */
const STEPS = ['Campaign details', 'Select template', 'Upload contacts', 'Validate contacts', 'Preview', 'Start campaign'];

export default function NewCampaignPage() {
  const navigate = useNavigate();
  const perms = useCampaignPermissions();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY_CAMPAIGN);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [config, setConfig] = useState(null);
  const [contactFilter, setContactFilter] = useState('rejected');

  const campaign = detail?.campaign || null;

  useEffect(() => {
    getCampaignConfig().then((r) => setConfig(r.data.data)).catch(() => {});
  }, []);

  const reload = useCallback(async (id = campaign?.id) => {
    if (!id) return null;
    const res = await getCampaign(id);
    setDetail(res.data.data);
    return res.data.data;
  }, [campaign?.id]);

  const saveSettings = async () => {
    const errs = validateCampaignForm(form, { section: 'template' });
    setErrors(errs);
    if (Object.keys(errs).length) return false;
    setSaving(true);
    try {
      if (!campaign) {
        const res = await createCampaign(form);
        await reload(res.data.data.id);
      } else {
        const res = await updateCampaign(campaign.id, form);
        if (res.data.contactsCleared) toast(res.data.message);
        await reload(campaign.id);
      }
      return true;
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save the campaign'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    if (step === 0) {
      const errs = validateCampaignForm(form, { section: 'details' });
      setErrors(errs);
      if (Object.keys(errs).length) return;
      if (campaign) {
        setSaving(true);
        try {
          await updateCampaign(campaign.id, { name: form.name });
          await reload();
        } catch (err) {
          toast.error(apiErrorMessage(err));
          setSaving(false);
          return;
        }
        setSaving(false);
      }
    }
    if (step === 1 && !(await saveSettings())) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const valid = campaign?.valid_contacts || 0;
  const blocked = (step === 2 && !detail?.latestImport) || (step === 3 && valid === 0);
  const canNext = !blocked && step < STEPS.length - 1;
  const exit = () => navigate(campaign ? `${BASE}/${campaign.id}` : BASE);

  if (!perms.canCreate) {
    return (
      <DeskShell title="New WhatsApp campaign" breadcrumb="Sell / WhatsApp Campaigns">
        <EmptyState title="Not allowed" body="You do not have permission to create WhatsApp campaigns." action={<Button onClick={() => navigate(BASE)}>Back to campaigns</Button>} />
      </DeskShell>
    );
  }

  const steps = STEPS.map((label, i) => ({
    key: label,
    label,
    state: i === step ? 'current' : i < step ? 'done' : 'todo',
    // Going back is always safe; going forward runs the step's own checks.
    onClick: i < step && !saving ? () => setStep(i) : undefined,
  }));

  return (
    <DeskShell
      title="New WhatsApp campaign"
      breadcrumb="Sell / WhatsApp Campaigns"
      subtitle={campaign ? `Saved as draft · #${campaign.id}` : 'Nothing is sent until you start the campaign.'}
      actions={<Button variant="quiet" onClick={exit}>{campaign ? 'Save & exit' : 'Back'}</Button>}
    >
      <div className="c-stack">
        <FlowSteps steps={steps} />

        {config && !config.sendingEnabled && (
          <Notice tone="warn" title="Sending is turned off on this server">
            You can prepare the campaign, but it cannot be started until an administrator enables it.
          </Notice>
        )}

        {step <= 1 && (
          <Section title={STEPS[step]}>
            <CampaignForm form={form} onChange={setForm} errors={errors} section={step === 0 ? 'details' : 'template'} />
          </Section>
        )}

        {step === 2 && campaign && (
          <ImportContactsPanel
            campaign={campaign}
            latestImport={detail.latestImport}
            imports={detail.imports}
            config={config}
            onImported={async () => { await reload(); setStep(3); }}
          />
        )}

        {step === 3 && campaign && (
          <>
            <Section title="Validation result">
              <ImportSummary campaignId={campaign.id} summary={detail.latestImport} />
              {valid === 0 && <Notice tone="crit" className="mt-3">No valid contacts — fix the file and upload it again.</Notice>}
            </Section>
            <ContactsPanel campaignId={campaign.id} filter={contactFilter} onFilterChange={setContactFilter} />
          </>
        )}

        {step === 4 && campaign && (
          <Section title="Message preview">
            <div className="c-form-grid" style={{ '--c-cols': 2, alignItems: 'start' }}>
              <div>
                <WhatsAppPreview
                  headerMediaUrl={detail.preview.headerMediaUrl}
                  text={detail.preview.text}
                  bodyValues={detail.preview.bodyValues}
                  templateName={campaign.template_name}
                  contactName={detail.preview.contact?.name}
                />
                {detail.preview.error && <Notice tone="crit" className="mt-3">{detail.preview.error}</Notice>}
              </div>
              <div className="c-stack text-ink-2 font-ui" style={{ gap: 8, fontSize: 'var(--d-base)' }}>
                <p className="m-0">The preview uses the first valid contact in your file.</p>
                <p className="m-0">
                  Interakt sends the <strong>approved</strong> template <strong>{campaign.template_name}</strong> ({campaign.language_code});
                  the text here is only a guide.
                </p>
                <p className="m-0">
                  Variables sent:{' '}
                  {(detail.preview.bodyValues || []).length
                    ? detail.preview.bodyValues.map((v, i) => <span key={i}>{i ? ', ' : ''}{`{{${i + 1}}}`} = <strong>{v}</strong></span>)
                    : 'none'}
                </p>
                <div><Button onClick={() => setStep(1)}>Edit template settings</Button></div>
              </div>
            </div>
          </Section>
        )}

        {step === 5 && campaign && (
          <Section title="Review & start">
            <KeyValue
              cols={2}
              items={[
                { label: 'Campaign name', value: campaign.name },
                { label: 'Template', value: `${campaign.template_name} (${campaign.language_code})` },
                { label: 'Header media', value: campaign.header_media_url ? <span className="break-all">{campaign.header_media_url}</span> : null },
                { label: 'Total contacts', value: formatNumber(campaign.total_contacts) },
                { label: 'Valid contacts', value: formatNumber(campaign.valid_contacts) },
                { label: 'Invalid contacts', value: formatNumber(campaign.invalid_contacts) },
                { label: 'Duplicate contacts', value: formatNumber(campaign.duplicate_contacts) },
                { label: 'Send rate', value: config ? `~${config.ratePerMinute} messages / minute (≈ ${Math.ceil(valid / (config.ratePerMinute || 200))} min)` : null },
              ]}
            />
            <div style={{ marginTop: 16 }}>
              {perms.canStart ? (
                <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
                  <CampaignActions campaign={campaign} exclude={['cancel']} onChanged={() => navigate(`${BASE}/${campaign.id}`)} />
                  <span className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>You will be asked to confirm.</span>
                </div>
              ) : (
                <Notice tone="info">
                  The campaign is saved and ready. Someone with the <strong>WhatsApp Campaigns — start</strong> permission must start it.
                </Notice>
              )}
            </div>
          </Section>
        )}

        <div className="c-actions-bar" style={{ justifyContent: 'space-between' }}>
          <Button disabled={step === 0 || saving} onClick={() => setStep((s) => s - 1)}>Previous</Button>
          {step < STEPS.length - 1 && (
            <Button variant={step === 2 ? 'secondary' : 'primary'} onClick={next} disabled={!canNext || saving}>
              {saving ? 'Saving…' : step === 1 && !campaign ? 'Save draft & continue' : 'Next'}
            </Button>
          )}
        </div>
      </div>
    </DeskShell>
  );
}
