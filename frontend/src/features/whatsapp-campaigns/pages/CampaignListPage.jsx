import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MessageCircle, Plus, Eye } from 'lucide-react';
import {
  Button, PageHeader, ResponsiveTable, SearchField, ListPagination, EmptyState,
} from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { listCampaigns, apiErrorMessage } from '../whatsappCampaignApi';
import { CampaignStatusBadge } from '../components/StatusBadge';
import CampaignActions, { useCampaignPermissions } from '../components/CampaignActions';
import { CAMPAIGN_STATUS, ACTIVE_STATUSES, formatDateTime, formatNumber } from '../campaignStatus';

const PAGE_SIZE = 25;

export default function CampaignListPage() {
  const navigate = useNavigate();
  const perms = useCampaignPermissions();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { setPage(1); }, [debounced, status]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await listCampaigns({ search: debounced, status, page, limit: PAGE_SIZE });
      setData({ rows: res.data.data, total: res.data.pagination.total, totalPages: res.data.pagination.totalPages });
    } catch (err) {
      if (!quiet) toast.error(apiErrorMessage(err, 'Failed to load campaigns'));
    } finally {
      setLoading(false);
    }
  }, [debounced, status, page]);

  useEffect(() => { load(); }, [load]);

  // Keep counters moving while any visible campaign is sending.
  const anyActive = data.rows.some((r) => ACTIVE_STATUSES.has(r.status));
  useEffect(() => {
    if (!anyActive) return undefined;
    const t = setInterval(() => { if (!document.hidden) load(true); }, 8000);
    return () => clearInterval(t);
  }, [anyActive, load]);

  const open = (row) => navigate(`/whatsapp-campaigns/${row.id}`);
  const n = (k) => (r) => formatNumber(r[k]);
  const columns = [
    { key: 'name', header: 'Campaign', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'template_name', header: 'Template', render: (r) => <span className="font-mono text-xs">{r.template_name}</span> },
    { key: 'total_contacts', header: 'Total', align: 'right', render: n('valid_contacts') },
    { key: 'sent_count', header: 'Sent', align: 'right', render: n('sent_count') },
    { key: 'delivered_count', header: 'Delivered', align: 'right', render: n('delivered_count') },
    { key: 'read_count', header: 'Read', align: 'right', render: n('read_count') },
    { key: 'failed_count', header: 'Failed', align: 'right', render: (r) => <span className={r.failed_count ? 'text-red-600' : ''}>{formatNumber(r.failed_count)}</span> },
    { key: 'status', header: 'Status', render: (r) => <CampaignStatusBadge status={r.status} /> },
    { key: 'created_at', header: 'Created', render: (r) => formatDateTime(r.created_at), className: 'whitespace-nowrap' },
    { key: 'created_by_name', header: 'Created by', render: (r) => r.created_by_name || '—' },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()} role="presentation">
          <Button size="sm" variant="ghost" icon={Eye} onClick={() => open(r)}>View</Button>
          <CampaignActions campaign={r} size="sm" onChanged={() => load(true)} />
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="WhatsApp Campaigns"
        subtitle="Bulk WhatsApp template messages sent through Interakt"
        icon={MessageCircle}
        actions={perms.canCreate && (
          <Button icon={Plus} onClick={() => navigate('/whatsapp-campaigns/new')}>New campaign</Button>
        )}
      />
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <SearchField value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaign or template" />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white"
        >
          <option value="">All statuses</option>
          {Object.entries(CAMPAIGN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <ResponsiveTable
        columns={columns}
        rows={data.rows}
        loading={loading}
        onRowClick={open}
        empty={(
          <EmptyState
            icon={MessageCircle}
            title="No campaigns yet"
            hint="Create a campaign, upload your contacts and send an approved WhatsApp template."
            action={perms.canCreate && <Button icon={Plus} onClick={() => navigate('/whatsapp-campaigns/new')}>New campaign</Button>}
          />
        )}
        renderCard={(r) => (
          <div className="space-y-2">
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{r.name}</span>
              <CampaignStatusBadge status={r.status} />
            </div>
            <div className="text-xs text-slate-500 font-mono">{r.template_name}</div>
            <div className="text-sm text-slate-600">
              {formatNumber(r.sent_count)} / {formatNumber(r.valid_contacts)} sent · {formatNumber(r.delivered_count)} delivered ·{' '}
              {formatNumber(r.read_count)} read · {formatNumber(r.failed_count)} failed
            </div>
            <CampaignActions campaign={r} size="sm" onChanged={() => load(true)} />
          </div>
        )}
      />
      <ListPagination page={page} totalPages={data.totalPages} total={data.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </div>
  );
}
