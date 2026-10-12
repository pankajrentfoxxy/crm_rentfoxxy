import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DateTime, DocumentHeader, EmptyState, KeyValue, Notice, Section,
} from '../../../../components/carret';
import {
  getCampaign, getCampaignStats, updateCampaign, deleteCampaign, apiErrorMessage,
} from '../../../whatsapp-campaigns/whatsappCampaignApi';
import { ACTIVE_STATUSES, isEditable, formatNumber } from '../../../whatsapp-campaigns/campaignStatus';
import { toCampaignForm, validateCampaignForm } from '../../../whatsapp-campaigns/components/CampaignSettingsForm';
import CampaignForm from './CampaignForm';
import {
  CampaignProgress, ContactsPanel, ImportContactsPanel, ImportSummary,
} from './CampaignPanels';
import {
  BASE, CampaignActions, CampaignChip, WhatsAppPreview, useCampaignPermissions, variablesText,
} from './campaignShared';

/**
 * Sell → WhatsApp Campaigns → one campaign. Progress with live counters,
 * settings (editable while Draft / Ready), the preview, the import, and every
 * contact with its send result. Start / Pause / Resume / Cancel show only when
 * the status allows them AND the user holds that action's sub-section grant.
 */
const ACTIVE_POLL_MS = 4000;
// Delivery / read receipts keep arriving after sending finishes.
const SETTLED_POLL_MS = 30000;

export default function CampaignRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perms = useCampaignPermissions();
  const [detail, setDetail] = useState(null);
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([getCampaign(id), getCampaignStats(id)]);
      setDetail(d.data.data);
      setStats(s.data.data);
    } catch (e) {
      if (e?.response?.status === 404) setErr('Campaign not found.');
      else setErr(apiErrorMessage(e, 'Failed to load campaign'));
    }
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const status = detail?.campaign?.status;
  useEffect(() => {
    if (!status) return undefined;
    let interval = null;
    if (ACTIVE_STATUSES.has(status)) interval = ACTIVE_POLL_MS;
    else if (['COMPLETED', 'PAUSED'].includes(status)) interval = SETTLED_POLL_MS;
    if (!interval) return undefined;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const s = await getCampaignStats(id);
        setStats(s.data.data);
        setRefreshKey((k) => k + 1);
        if (s.data.data.status !== status) loadAll();
      } catch { /* next poll */ }
    }, interval);
    return () => clearInterval(t);
  }, [id, status, loadAll]);

  const refresh = () => { loadAll(); setRefreshKey((k) => k + 1); };

  if (err && !detail) {
    return (
      <DeskShell title={`Campaign #${id}`} breadcrumb="Sell / WhatsApp Campaigns">
        <EmptyState title="Could not load" body={err} action={<Button onClick={() => navigate(BASE)}>Back to campaigns</Button>} />
      </DeskShell>
    );
  }
  if (!detail) {
    return <DeskShell title={`Campaign #${id}`} breadcrumb="Sell / WhatsApp Campaigns"><EmptyState title="Loading…" /></DeskShell>;
  }

  const {
    campaign, latestImport, imports, preview, config,
  } = detail;
  const editable = isEditable(campaign.status);
  const hasContacts = campaign.total_contacts > 0;

  const save = async () => {
    const errs = validateCampaignForm(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const res = await updateCampaign(campaign.id, form);
      toast.success(res.data.message || 'Saved');
      setEditing(false);
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deleteCampaign(campaign.id);
      toast.success('Campaign deleted');
      navigate(BASE);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not delete'));
    }
  };

  const sendingStates = ['READY', 'QUEUED', 'PROCESSING', 'PAUSED'];

  return (
    <DeskShell
      title={campaign.name}
      breadcrumb="Sell / WhatsApp Campaigns"
      actions={<Button variant="quiet" onClick={() => navigate(BASE)}>All campaigns</Button>}
    >
      <div className="c-stack">
        <DocumentHeader
          docNumber={`Campaign #${campaign.id}`}
          type="WhatsApp campaign"
          actions={(
            <>
              <CampaignActions campaign={campaign} onChanged={refresh} />
              {editable && perms.canDelete && <Button variant="quiet" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            </>
          )}
          meta={[
            { label: 'Status', value: <CampaignChip status={campaign.status} /> },
            { label: 'Template', value: `${campaign.template_name} · ${campaign.language_code}` },
            { label: 'Created', value: <><DateTime value={campaign.created_at} format="datetime" />{campaign.created_by_name ? ` by ${campaign.created_by_name}` : ''}</> },
            { label: 'Started', value: campaign.started_at ? <DateTime value={campaign.started_at} format="datetime" /> : '—' },
            { label: 'Finished', value: campaign.completed_at ? <DateTime value={campaign.completed_at} format="datetime" /> : '—' },
          ]}
        />

        {!config.sendingEnabled && sendingStates.includes(campaign.status) && (
          <Notice tone="warn" title="Sending is turned off on this server">
            OUTBOUND_MESSAGING_ENABLED / INTERAKT_API_KEY is not set. Queued messages wait and are not counted as failed.
          </Notice>
        )}
        {campaign.last_error && <Notice tone="crit">{campaign.last_error}</Notice>}
        {!config.webhookConfigured && !editable && (
          <Notice tone="info">
            Delivered / read counts need the Interakt webhook (INTERAKT_WEBHOOK_TOKEN) — until it is set up they stay at 0.
          </Notice>
        )}

        {hasContacts && !editable && <CampaignProgress stats={stats} onFilter={setFilter} activeFilter={filter} />}

        <div className="c-split">
          <Section
            title="Campaign settings"
            actions={editable && perms.canEdit && !editing && (
              <Button onClick={() => { setForm(toCampaignForm(campaign)); setErrors({}); setEditing(true); }}>Edit</Button>
            )}
          >
            {editing ? (
              <div className="c-stack" style={{ gap: 12 }}>
                <CampaignForm form={form} onChange={setForm} errors={errors} columns={latestImport?.columns || null} />
                {hasContacts && (
                  <Notice tone="warn">Changing the template variables removes the imported contacts — you will need to upload the file again.</Notice>
                )}
                <div className="flex" style={{ gap: 8 }}>
                  <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                  <Button onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                </div>
              </div>
            ) : (
              <KeyValue
                cols={2}
                items={[
                  { label: 'Template', value: campaign.template_name },
                  { label: 'Language', value: campaign.language_code },
                  { label: 'Header media', value: campaign.header_media_url ? <span className="break-all">{campaign.header_media_url}</span> : null },
                  { label: 'Variables', value: variablesText(campaign.body_variables) },
                  { label: 'Total contacts', value: formatNumber(campaign.total_contacts) },
                  {
                    label: 'Valid / invalid / duplicate',
                    value: `${formatNumber(campaign.valid_contacts)} / ${formatNumber(campaign.invalid_contacts)} / ${formatNumber(campaign.duplicate_contacts)}`,
                  },
                ]}
              />
            )}
          </Section>
          <Section title="Preview">
            <WhatsAppPreview
              headerMediaUrl={preview.headerMediaUrl}
              text={preview.text}
              bodyValues={preview.bodyValues}
              templateName={campaign.template_name}
              contactName={preview.contact?.name || (preview.sample ? 'a sample contact (no contacts yet)' : null)}
            />
            {preview.error && hasContacts && <Notice tone="crit" className="mt-3">{preview.error}</Notice>}
          </Section>
        </div>

        {editable && perms.canCreate && (
          <ImportContactsPanel campaign={campaign} latestImport={latestImport} imports={imports} config={config} onImported={refresh} />
        )}
        {!(editable && perms.canCreate) && latestImport && (
          <Section title="Import">
            <p className="text-ink-3 font-ui m-0" style={{ fontSize: 'var(--d-sm)', marginBottom: 12 }}>
              {latestImport.file_name} · <DateTime value={latestImport.imported_at} format="datetime" />
              {latestImport.imported_by_name ? ` · ${latestImport.imported_by_name}` : ''}
            </p>
            <ImportSummary campaignId={campaign.id} summary={latestImport} />
          </Section>
        )}

        {hasContacts && (
          <ContactsPanel campaignId={campaign.id} filter={filter} onFilterChange={setFilter} refreshKey={refreshKey} />
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete campaign?"
        body="This removes the campaign and its imported contacts. Nothing has been sent."
        confirmLabel="Delete"
        tone="crit"
      />
    </DeskShell>
  );
}
