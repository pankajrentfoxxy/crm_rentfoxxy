import React, { useState } from 'react';
import toast from 'react-hot-toast';
import {
  Play, Pause, RotateCcw, XCircle,
} from 'lucide-react';
import { Button } from '../../../components/ui/primitives';
import usePermission from '../../../hooks/usePermission';
import ConfirmDialog from './ConfirmDialog';
import { campaignActions, formatNumber } from '../campaignStatus';
import {
  startCampaign, pauseCampaign, resumeCampaign, cancelCampaign, apiErrorMessage,
} from '../whatsappCampaignApi';

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
  start: { label: 'Start', icon: Play, variant: 'success', run: startCampaign },
  pause: { label: 'Pause', icon: Pause, variant: 'secondary', run: pauseCampaign },
  resume: { label: 'Resume', icon: RotateCcw, variant: 'primary', run: resumeCampaign },
  cancel: { label: 'Cancel', icon: XCircle, variant: 'danger', run: cancelCampaign },
};

/** Start / Pause / Resume / Cancel buttons valid for the campaign's status and the user's grants. */
export default function CampaignActions({ campaign, onChanged, size = 'md', exclude = [] }) {
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
      setConfirm(null);
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()} role="presentation">
        {actions.map((a) => (
          <Button
            key={a}
            size={size}
            variant={META[a].variant}
            icon={META[a].icon}
            loading={busy === a}
            onClick={() => (a === 'start' || a === 'cancel' ? setConfirm(a) : run(a))}
          >
            {META[a].label}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        open={confirm === 'start'}
        title="Start campaign?"
        confirmLabel="Yes, start sending"
        tone="success"
        loading={busy === 'start'}
        onConfirm={() => run('start')}
        onClose={() => setConfirm(null)}
      >
        <p>Are you sure you want to start this campaign?</p>
        <p>
          <b>{formatNumber(campaign.valid_contacts)}</b> WhatsApp messages using template <b>{campaign.template_name}</b> will
          be sent to real customers. Sent messages cannot be recalled.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Cancel campaign?"
        confirmLabel="Cancel campaign"
        tone="danger"
        loading={busy === 'cancel'}
        onConfirm={() => run('cancel')}
        onClose={() => setConfirm(null)}
      >
        <p>Contacts that have not been sent yet will be skipped. This cannot be undone.</p>
        <p>Messages already sent cannot be recalled.</p>
      </ConfirmDialog>
    </>
  );
}
