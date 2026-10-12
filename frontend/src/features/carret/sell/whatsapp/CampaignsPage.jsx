import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, EmptyState, FilterBar, Panel,
} from '../../../../components/carret';
import { listCampaigns, apiErrorMessage } from '../../../whatsapp-campaigns/whatsappCampaignApi';
import { CAMPAIGN_STATUS, ACTIVE_STATUSES, formatNumber } from '../../../whatsapp-campaigns/campaignStatus';
import {
  BASE, CampaignActions, CampaignChip, useCampaignPermissions,
} from './campaignShared';

/**
 * Sell → WhatsApp Campaigns. Bulk Interakt template sends: every campaign with
 * its counters, a status filter and the actions this user may take. Counters
 * keep moving while any campaign on the page is sending. The old screen
 * (/whatsapp-campaigns) stays routed for the Old UI sidebar.
 */
const PAGE_SIZE = 25;
const STATUS_OPTIONS = Object.entries(CAMPAIGN_STATUS).map(([value, s]) => ({ value, label: s.label }));

export default function CampaignsPage() {
  const navigate = useNavigate();
  const perms = useCampaignPermissions();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [debounced, status]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setData(null);
    try {
      const res = await listCampaigns({ search: debounced, status, page, limit: PAGE_SIZE });
      setData({ rows: res.data.data || [], total: res.data.pagination?.total || 0, totalPages: res.data.pagination?.totalPages || 1 });
    } catch (err) {
      if (!quiet) { toast.error(apiErrorMessage(err, 'Failed to load campaigns')); setData({ rows: [], total: 0, totalPages: 1 }); }
    }
  }, [debounced, status, page]);

  useEffect(() => { load(); }, [load]);

  const anyActive = (data?.rows || []).some((r) => ACTIVE_STATUSES.has(r.status));
  useEffect(() => {
    if (!anyActive) return undefined;
    const t = setInterval(() => { if (!document.hidden) load(true); }, 8000);
    return () => clearInterval(t);
  }, [anyActive, load]);

  const open = (r) => navigate(`${BASE}/${r.id}`);
  const n = (k) => (r) => formatNumber(r[k]);
  const columns = [
    { key: 'name', header: 'Campaign', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span>, sub: (r) => r.template_name },
    { key: 'status', header: 'Status', render: (r) => <CampaignChip status={r.status} /> },
    { key: 'valid', header: 'Contacts', numeric: true, render: n('valid_contacts') },
    { key: 'sent', header: 'Sent', numeric: true, render: n('sent_count') },
    { key: 'delivered', header: 'Delivered', numeric: true, render: n('delivered_count') },
    { key: 'read', header: 'Read', numeric: true, render: n('read_count') },
    {
      key: 'failed',
      header: 'Failed',
      numeric: true,
      render: (r) => <span style={r.failed_count ? { color: 'var(--alert-crit)', fontWeight: 600 } : undefined}>{formatNumber(r.failed_count)}</span>,
    },
    { key: 'created', header: 'Created', render: (r) => <DateTime value={r.created_at} format="datetime" />, sub: (r) => r.created_by_name || null },
    { key: 'actions', header: '', align: 'right', render: (r) => <CampaignActions campaign={r} compact onChanged={() => load(true)} /> },
  ];

  const filtersSet = Boolean(search || status);
  const newButton = perms.canCreate && <Button variant="primary" onClick={() => navigate(`${BASE}/new`)}>New campaign</Button>;

  return (
    <DeskShell
      title="WhatsApp Campaigns"
      breadcrumb="Sell / Marketing"
      subtitle="Bulk WhatsApp template messages sent through Interakt."
      actions={newButton}
    >
      <div className="c-stack">
        <Panel
          toolbar={(
            <FilterBar
              filters={[
                { key: 'search', label: 'Search', type: 'search', placeholder: 'Campaign or template' },
                { key: 'status', label: 'Status', options: STATUS_OPTIONS },
              ]}
              values={{ search, status }}
              onChange={(k, v) => (k === 'search' ? setSearch(v) : setStatus(v))}
              onClear={filtersSet ? () => { setSearch(''); setStatus(''); } : undefined}
              count={data ? `${formatNumber(data.total)} campaign${data.total === 1 ? '' : 's'}` : null}
            />
          )}
        >
          {data === null ? <EmptyState title="Loading campaigns…" /> : (
            <DataTable
              columns={columns}
              rows={data.rows}
              onRowClick={open}
              empty={filtersSet
                ? <EmptyState title="No campaigns match" body="Clear a filter to see the rest." />
                : <EmptyState title="No campaigns yet" body="Create a campaign, upload your contacts and send an approved WhatsApp template." action={newButton} />}
            />
          )}
          {data && data.totalPages > 1 && (
            <div className="flex items-center" style={{ gap: 8, padding: '8px 12px' }}>
              <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-ink-3">Page {page} of {data.totalPages}</span>
              <Button variant="quiet" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
