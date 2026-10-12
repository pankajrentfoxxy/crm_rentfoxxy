import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  MessageCircle, ArrowLeft, AlertTriangle, Pencil, Trash2, Save,
} from 'lucide-react';
import {
  Button, Card, PageHeader, SectionLoader,
} from '../../../components/ui/primitives';
import { CampaignStatusBadge } from '../components/StatusBadge';
import CampaignActions, { useCampaignPermissions } from '../components/CampaignActions';
import CampaignProgress from '../components/CampaignProgress';
import ImportContactsPanel, { ImportSummary } from '../components/ImportContactsPanel';
import WhatsAppPreview from '../components/WhatsAppPreview';
import ContactsTable from '../components/ContactsTable';
import ConfirmDialog from '../components/ConfirmDialog';
import CampaignSettingsForm, { toCampaignForm, validateCampaignForm } from '../components/CampaignSettingsForm';
import {
  getCampaign, getCampaignStats, updateCampaign, deleteCampaign, apiErrorMessage,
} from '../whatsappCampaignApi';
import { ACTIVE_STATUSES, isEditable, formatDateTime } from '../campaignStatus';

const ACTIVE_POLL_MS = 4000;
// Delivery / read receipts keep arriving after sending finishes.
const SETTLED_POLL_MS = 30000;

export default function CampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perms = useCampaignPermissions();
  const [detail, setDetail] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
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
    } catch (err) {
      if (err?.response?.status === 404) setNotFound(true);
      else toast.error(apiErrorMessage(err, 'Failed to load campaign'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const status = detail?.campaign?.status;
  useEffect(() => {
    if (!status) return undefined;
    const interval = ACTIVE_STATUSES.has(status) ? ACTIVE_POLL_MS
      : ['COMPLETED', 'PAUSED'].includes(status) ? SETTLED_POLL_MS : null;
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

  if (loading) return <SectionLoader />;
  if (notFound || !detail) {
    return (
      <div className="p-6">
        <p className="text-slate-600">Campaign not found.</p>
        <Button variant="secondary" icon={ArrowLeft} className="mt-3" onClick={() => navigate('/whatsapp-campaigns')}>Back to campaigns</Button>
      </div>
    );
  }

  const { campaign, latestImport, imports, preview, config } = detail;
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
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deleteCampaign(campaign.id);
      toast.success('Campaign deleted');
      navigate('/whatsapp-campaigns');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete'));
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title={campaign.name}
        subtitle={(
          <span className="flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            <span className="font-mono">{campaign.template_name}</span>
            <span>· {campaign.language_code}</span>
            <span>· created {formatDateTime(campaign.created_at)}{campaign.created_by_name ? ` by ${campaign.created_by_name}` : ''}</span>
            {campaign.started_at && <span>· started {formatDateTime(campaign.started_at)}</span>}
            {campaign.completed_at && <span>· finished {formatDateTime(campaign.completed_at)}</span>}
          </span>
        )}
        icon={MessageCircle}
        actions={(
          <>
            <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/whatsapp-campaigns')}>All campaigns</Button>
            <CampaignActions campaign={campaign} onChanged={refresh} />
            {editable && perms.canDelete && (
              <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)}>Delete</Button>
            )}
          </>
        )}
      />

      {!config.sendingEnabled && ['READY', 'QUEUED', 'PROCESSING', 'PAUSED'].includes(campaign.status) && (
        <div className="flex gap-2 items-start text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          WhatsApp sending is turned off on this server (OUTBOUND_MESSAGING_ENABLED / INTERAKT_API_KEY). Queued messages wait and are not counted as failed.
        </div>
      )}
      {campaign.last_error && (
        <div className="flex gap-2 items-start text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {campaign.last_error}
        </div>
      )}
      {!config.webhookConfigured && !editable && (
        <p className="text-xs text-slate-500">
          Delivered / read counts need the Interakt webhook (INTERAKT_WEBHOOK_TOKEN) — until it is set up they stay at 0.
        </p>
      )}

      {hasContacts && !editable && <CampaignProgress stats={stats} onFilter={setFilter} activeFilter={filter} />}

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Campaign settings</h3>
            {editable && perms.canEdit && !editing && (
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => { setForm(toCampaignForm(campaign)); setErrors({}); setEditing(true); }}>Edit</Button>
            )}
          </div>
          {editing ? (
            <div className="space-y-4">
              <CampaignSettingsForm form={form} onChange={setForm} errors={errors} columns={latestImport?.columns || null} />
              {hasContacts && (
                <p className="text-xs text-amber-700">Changing the template variables removes the imported contacts — you will need to upload the file again.</p>
              )}
              <div className="flex gap-2">
                <Button icon={Save} onClick={save} loading={saving}>Save</Button>
                <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
              </div>
            </div>
          ) : (
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                ['Template', campaign.template_name],
                ['Language', campaign.language_code],
                ['Header media', campaign.header_media_url || '—'],
                ['Variables', (campaign.body_variables || []).map((v, i) => `{{${i + 1}}} = ${v.source === 'static' ? `"${v.value}"` : v.key}`).join(', ') || 'none'],
                ['Total contacts', campaign.total_contacts],
                ['Valid / Invalid / Duplicate', `${campaign.valid_contacts} / ${campaign.invalid_contacts} / ${campaign.duplicate_contacts}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-medium text-slate-800 text-right break-all">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold text-slate-900 mb-3">Preview</h3>
          <WhatsAppPreview
            headerMediaUrl={preview.headerMediaUrl}
            text={preview.text}
            bodyValues={preview.bodyValues}
            templateName={campaign.template_name}
            contactName={preview.contact?.name || (preview.sample ? 'a sample contact (no contacts yet)' : null)}
          />
          {preview.error && hasContacts && <p className="text-sm text-red-700 mt-2">{preview.error}</p>}
        </Card>
      </div>

      {editable && perms.canCreate ? (
        <ImportContactsPanel campaign={campaign} latestImport={latestImport} imports={imports} config={config} onImported={refresh} />
      ) : latestImport && (
        <Card className="p-5 space-y-3">
          <h3 className="font-semibold text-slate-900">Import</h3>
          <p className="text-xs text-slate-500">
            {latestImport.file_name} · {formatDateTime(latestImport.imported_at)}{latestImport.imported_by_name ? ` · ${latestImport.imported_by_name}` : ''}
          </p>
          <ImportSummary campaignId={campaign.id} summary={latestImport} />
        </Card>
      )}

      {hasContacts && (
        <ContactsTable campaignId={campaign.id} filter={filter} onFilterChange={setFilter} refreshKey={refreshKey} />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete campaign?"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      >
        <p>This removes the campaign and its imported contacts. Nothing has been sent.</p>
      </ConfirmDialog>
    </div>
  );
}
