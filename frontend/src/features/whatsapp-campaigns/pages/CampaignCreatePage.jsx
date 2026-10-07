import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  MessageCircle, ArrowLeft, ArrowRight, Check, AlertTriangle,
} from 'lucide-react';
import { Button, Card, PageHeader } from '../../../components/ui/primitives';
import CampaignSettingsForm, { EMPTY_CAMPAIGN, validateCampaignForm } from '../components/CampaignSettingsForm';
import ImportContactsPanel, { ImportSummary } from '../components/ImportContactsPanel';
import WhatsAppPreview from '../components/WhatsAppPreview';
import ContactsTable from '../components/ContactsTable';
import CampaignActions, { useCampaignPermissions } from '../components/CampaignActions';
import {
  createCampaign, updateCampaign, getCampaign, getCampaignConfig, apiErrorMessage,
} from '../whatsappCampaignApi';
import { formatNumber } from '../campaignStatus';

const STEPS = ['Campaign details', 'Select template', 'Upload contacts', 'Validate contacts', 'Preview', 'Start campaign'];

function Stepper({ step }) {
  return (
    <ol className="flex flex-wrap gap-2 mb-5">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border ${
            i === step ? 'bg-blue-600 text-white border-blue-600'
              : i < step ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-500 border-slate-200'}`}
        >
          <span className="font-semibold">{i < step ? <Check className="w-4 h-4" /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export default function CampaignCreatePage() {
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
        try { await updateCampaign(campaign.id, { name: form.name }); await reload(); } catch (err) {
          toast.error(apiErrorMessage(err)); setSaving(false); return;
        }
        setSaving(false);
      }
    }
    if (step === 1 && !(await saveSettings())) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const valid = campaign?.valid_contacts || 0;
  const canNext = (step === 2 && !detail?.latestImport) || (step === 3 && valid === 0) ? false : step < STEPS.length - 1;

  if (!perms.canCreate) {
    return <div className="p-6 text-slate-600">You do not have permission to create WhatsApp campaigns.</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="New WhatsApp campaign"
        subtitle={campaign ? `Saved as draft · #${campaign.id}` : 'Nothing is sent until you start the campaign'}
        icon={MessageCircle}
        actions={<Button variant="ghost" icon={ArrowLeft} onClick={() => navigate(campaign ? `/whatsapp-campaigns/${campaign.id}` : '/whatsapp-campaigns')}>{campaign ? 'Save & exit' : 'Back'}</Button>}
      />
      <Stepper step={step} />

      {config && !config.sendingEnabled && (
        <div className="mb-4 flex gap-2 items-start text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          WhatsApp sending is turned off on this server. You can prepare the campaign, but it cannot be started until an administrator enables it.
        </div>
      )}

      {step <= 1 && (
        <Card className="p-5">
          <CampaignSettingsForm form={form} onChange={setForm} errors={errors} section={step === 0 ? 'details' : 'template'} />
        </Card>
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
        <div className="space-y-4">
          <Card className="p-5 space-y-3">
            <h3 className="font-semibold text-slate-900">Validation result</h3>
            <ImportSummary campaignId={campaign.id} summary={detail.latestImport} />
            {valid === 0 && <p className="text-sm text-red-700">No valid contacts — fix the file and upload it again.</p>}
          </Card>
          <ContactsTable campaignId={campaign.id} filter={contactFilter} onFilterChange={setContactFilter} />
        </div>
      )}

      {step === 4 && campaign && (
        <Card className="p-5 grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-slate-900 mb-3">Message preview</h3>
            <WhatsAppPreview
              headerMediaUrl={detail.preview.headerMediaUrl}
              text={detail.preview.text}
              bodyValues={detail.preview.bodyValues}
              templateName={campaign.template_name}
              contactName={detail.preview.contact?.name}
            />
            {detail.preview.error && <p className="text-sm text-red-700 mt-2">{detail.preview.error}</p>}
          </div>
          <div className="text-sm text-slate-600 space-y-2">
            <p>The preview uses the first valid contact in your file.</p>
            <p>
              Interakt sends the <b>approved</b> template <span className="font-mono">{campaign.template_name}</span> ({campaign.language_code});
              the text above is only a guide. Variables sent: {detail.preview.bodyValues.map((v, i) => <span key={i} className="font-mono">{`{{${i + 1}}}`}={v} </span>)}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setStep(1)}>Edit template settings</Button>
          </div>
        </Card>
      )}

      {step === 5 && campaign && (
        <Card className="p-5 space-y-4">
          <h3 className="font-semibold text-slate-900">Review &amp; start</h3>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {[
              ['Campaign name', campaign.name],
              ['Template', `${campaign.template_name} (${campaign.language_code})`],
              ['Header image', campaign.header_media_url || '—'],
              ['Total contacts', formatNumber(campaign.total_contacts)],
              ['Valid contacts', formatNumber(campaign.valid_contacts)],
              ['Invalid contacts', formatNumber(campaign.invalid_contacts)],
              ['Duplicate contacts', formatNumber(campaign.duplicate_contacts)],
              ['Send rate', config ? `~${config.ratePerMinute} messages / minute (≈ ${Math.ceil(valid / (config.ratePerMinute || 200))} min)` : '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-medium text-slate-800 text-right break-all">{v}</dd>
              </div>
            ))}
          </dl>
          {perms.canStart ? (
            <div className="flex flex-wrap items-center gap-3">
              <CampaignActions campaign={campaign} exclude={['cancel']} onChanged={() => navigate(`/whatsapp-campaigns/${campaign.id}`)} />
              <span className="text-xs text-slate-500">You will be asked to confirm.</span>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              The campaign is saved and ready. Someone with the <b>WhatsApp Campaigns — start</b> permission must start it.
            </p>
          )}
        </Card>
      )}

      <div className="flex justify-between mt-5">
        <Button variant="secondary" icon={ArrowLeft} disabled={step === 0 || saving} onClick={() => setStep((s) => s - 1)}>Previous</Button>
        {step < STEPS.length - 1 && (
          <Button iconRight={ArrowRight} onClick={next} loading={saving} disabled={!canNext}>
            {step === 1 && !campaign ? 'Save draft & continue' : 'Next'}
          </Button>
        )}
      </div>
    </div>
  );
}
