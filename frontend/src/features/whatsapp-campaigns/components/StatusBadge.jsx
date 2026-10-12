import React from 'react';
import { Badge } from '../../../components/ui/primitives';
import { CAMPAIGN_STATUS, CONTACT_STATUS } from '../campaignStatus';

export function CampaignStatusBadge({ status }) {
  const s = CAMPAIGN_STATUS[status] || { label: status, tone: 'gray' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ContactStatusBadge({ status }) {
  const s = CONTACT_STATUS[status] || { label: status, tone: 'gray' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
