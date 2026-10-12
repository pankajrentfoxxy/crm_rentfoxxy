import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, ConfirmDialog, StatusChip } from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { CAMPAIGN_STATUS, CONTACT_STATUS, campaignActions, formatNumber } from '../../../whatsapp-campaigns/campaignStatus';
import {
  startCampaign, pauseCampaign, resumeCampaign, cancelCampaign, apiErrorMessage,
} from '../../../whatsapp-campaigns/whatsappCampaignApi';

/**
 * Sell → WhatsApp Campaigns, shared bits for the three Carret pages.
 *
 * The API client, the status table and the action rules are the old feature's
 * own files (features/whatsapp-campaigns/), imported rather than copied, so the
 * old screens and these cannot drift apart.
 *
 * Campaign / contact statuses are not asset states, so they do not belong in
 * config/statuses.js. Like the other non-asset chips (chargers, part inward,
 * vendor bills) each one maps onto a document status StatusChip already knows
 * — a tone and a glyph — and carries its own word.
 */
export const BASE = '/carret/sell/whatsapp-campaigns';

const CAMPAIGN_CHIP = {
  DRAFT: 'draft',
  READY: 'pending',
  QUEUED: 'processing',
  PROCESSING: 'processing',
  PAUSED: 'partial',
  COMPLETED: 'completed',
  FAILED: 'rejected',
  CANCELLED: 'cancelled',
};

const CONTACT_CHIP = {
  PENDING: 'pending',
  QUEUED: 'pending',
  SENDING: 'processing',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'completed',
  FAILED: 'rejected',
  SKIPPED: 'cancelled',
};

export function CampaignChip({ status }) {
  return <StatusChip status={CAMPAIGN_CHIP[status] || status} label={CAMPAIGN_STATUS[status]?.label || status} />;
}

export function ContactChip({ status }) {
  return <StatusChip status={CONTACT_CHIP[status] || status} label={CONTACT_STATUS[status]?.label || status} />;
}

/** The same grants the old screens read (whatsapp_campaigns + the three action sub-sections). */
export function useCampaignPermissions() {
  const { hasPermission } = usePermission();
  return {
    canCreate: hasPermission('whatsapp_campaigns', 'create'),
    canEdit: hasPermission('whatsapp_campaigns', 'edit'),
    canDelete: hasPermission('whatsapp_campaigns', 'delete'),
    canStart: hasPermission('whatsapp_campaigns_start', 'edit'),
    canPause: hasPermission('whatsapp_campaigns_pause', 'edit'),
    canCancel: hasPermission('whatsapp_campaigns_cancel', 'edit'),
  };
}

const META = {
  start: { label: 'Start', variant: 'primary', run: startCampaign },
  pause: { label: 'Pause', variant: 'secondary', run: pauseCampaign },
  resume: { label: 'Resume', variant: 'primary', run: resumeCampaign },
  cancel: { label: 'Cancel campaign', variant: 'quiet', run: cancelCampaign },
};

/**
 * Start / Pause / Resume / Cancel — only those valid for the status AND the
 * user's grants. Start and Cancel ask first: one sends to real customers, the
 * other cannot be undone.
 */
export function CampaignActions({ campaign, onChanged, exclude = [], compact = false }) {
  const perms = useCampaignPermissions();
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState('');
  const actions = campaignActions(campaign.status, perms).filter((a) => !exclude.includes(a));
  if (!actions.length) return null;

  const run = async (action) => {
    setBusy(action);
    try {
      const res = await META[action].run(campaign.id);
      toast.success(res.data?.message || 'Done');
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    // One wrapper stops clicks reaching a list row — the dialogs too, since
    // React bubbles through the component tree, not the DOM.
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
      <span className={compact ? 'c-row-actions' : 'inline-flex flex-wrap items-center'} style={compact ? undefined : { gap: 8 }}>
        {actions.map((a) => (
          <Button
            key={a}
            variant={compact ? 'quiet' : META[a].variant}
            disabled={Boolean(busy)}
            onClick={() => (a === 'start' || a === 'cancel' ? setConfirm(a) : run(a))}
          >
            {busy === a ? `${META[a].label}…` : (compact && a === 'cancel' ? 'Cancel' : META[a].label)}
          </Button>
        ))}
      </span>
      <ConfirmDialog
        open={confirm === 'start'}
        onClose={() => setConfirm(null)}
        onConfirm={() => run('start')}
        title="Start campaign?"
        body={`${formatNumber(campaign.valid_contacts)} WhatsApp messages using template ${campaign.template_name} will be sent to real customers. Sent messages cannot be recalled.`}
        confirmLabel="Yes, start sending"
        tone="good"
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        onConfirm={() => run('cancel')}
        title="Cancel campaign?"
        body="Contacts not sent yet will be skipped. This cannot be undone, and messages already sent cannot be recalled."
        confirmLabel="Cancel campaign"
        tone="crit"
      />
    </span>
  );
}

/**
 * A WhatsApp-style bubble. `text` is the template body with the variables
 * already filled in by the server from the first valid contact.
 */
export function WhatsAppPreview({ headerMediaUrl, text, bodyValues = [], templateName, contactName }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--d-radius-lg)', padding: 12 }}>
      <div className="bg-surface border border-rule" style={{ borderRadius: 'var(--d-radius)', overflow: 'hidden', maxWidth: 300, boxShadow: 'var(--shadow)' }}>
        {headerMediaUrl && (imgFailed ? (
          <div className="text-ink-3 font-ui" style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-3)', fontSize: 'var(--d-sm)', padding: 8, textAlign: 'center' }}>
            Header media could not be loaded in the browser
          </div>
        ) : (
          <img
            src={headerMediaUrl}
            alt="Template header"
            style={{ width: '100%', maxHeight: 190, objectFit: 'cover', background: 'var(--surface-3)', display: 'block' }}
            onError={() => setImgFailed(true)}
            referrerPolicy="no-referrer"
          />
        ))}
        <div className="text-ink font-ui" style={{ padding: '8px 12px', fontSize: 'var(--d-base)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {text || (
            <span className="text-ink-3">
              Template <strong>{templateName}</strong> with
              {bodyValues.length
                ? bodyValues.map((v, i) => <span key={i}> {`{{${i + 1}}}`} = <strong>{v}</strong>{i < bodyValues.length - 1 ? ',' : ''}</span>)
                : ' no variables'}
              <br />
              <span style={{ fontSize: 'var(--d-sm)' }}>Paste the template body in the campaign settings to see the full message.</span>
            </span>
          )}
        </div>
        <div className="text-ink-4 font-ui" style={{ padding: '0 12px 4px', textAlign: 'right', fontSize: 11 }}>now</div>
      </div>
      {contactName && <p className="text-ink-3 font-ui m-0" style={{ fontSize: 'var(--d-sm)', marginTop: 8 }}>Preview for {contactName}</p>}
    </div>
  );
}

/** The body variables as one line: {{1}} = name, {{2}} = "Diwali". */
export const variablesText = (vars) => (vars || [])
  .map((v, i) => `{{${i + 1}}} = ${v.source === 'static' ? `"${v.value}"` : v.key}`)
  .join(', ') || 'none';
