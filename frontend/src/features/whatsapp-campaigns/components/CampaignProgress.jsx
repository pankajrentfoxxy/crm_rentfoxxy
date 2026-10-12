import React from 'react';
import {
  Users, Clock, Send, CheckCheck, Eye, XCircle,
} from 'lucide-react';
import { Card, StatCard } from '../../../components/ui/primitives';
import { formatNumber } from '../campaignStatus';

export default function CampaignProgress({ stats, onFilter, activeFilter }) {
  if (!stats) return null;
  const valid = stats.valid || 0;
  const done = (stats.processed || 0) + (stats.cancelled || 0);
  const pct = stats.progressPercent || 0;
  const pctOf = (n) => (valid ? `${Math.round(((n || 0) / valid) * 100)}% of valid` : undefined);
  const card = (label, value, icon, tone, filter, hint) => (
    <StatCard
      label={label}
      value={formatNumber(value)}
      icon={icon}
      tone={tone}
      hint={hint}
      onClick={onFilter ? () => onFilter(filter) : undefined}
      active={activeFilter === filter}
    />
  );

  return (
    <Card className="p-5 space-y-4">
      <div>
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-semibold text-slate-800">
            Progress: {formatNumber(done)} / {formatNumber(valid)}
          </span>
          <span className="text-slate-600">{pct}%</span>
        </div>
        <div className="h-3 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <p className="text-xs text-slate-500 mt-2">
          {stats.status === 'PROCESSING' && `Sending ~${formatNumber(stats.sentLastMinute)} / minute`}
          {stats.etaMinutes ? ` · about ${stats.etaMinutes} min remaining` : ''}
          {stats.status === 'PAUSED' && 'Paused — remaining contacts stay queued until you resume.'}
          {stats.cancelled ? ` · ${formatNumber(stats.cancelled)} not sent (cancelled)` : ''}
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {card('Total', stats.total, Users, 'gray', 'all', `${formatNumber(valid)} valid`)}
        {card('Queued', stats.queued, Clock, 'purple', 'pending')}
        {card('Sent', stats.sent, Send, 'blue', 'sent', pctOf(stats.sent))}
        {card('Delivered', stats.delivered, CheckCheck, 'green', 'delivered', pctOf(stats.delivered))}
        {card('Read', stats.read, Eye, 'teal', 'read', pctOf(stats.read))}
        {card('Failed', stats.failed, XCircle, 'red', 'failed', pctOf(stats.failed))}
      </div>
    </Card>
  );
}
