import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Download } from 'lucide-react';
import {
  Button, Card, ResponsiveTable, SearchField, ListPagination,
} from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { ContactStatusBadge } from './StatusBadge';
import { listCampaignContacts, downloadCampaignContacts, apiErrorMessage } from '../whatsappCampaignApi';
import { friendlyError, formatDateTime } from '../campaignStatus';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'sent', label: 'Sent' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'read', label: 'Read' },
  { key: 'failed', label: 'Failed' },
  { key: 'rejected', label: 'Invalid / Duplicate' },
];
const PAGE_SIZE = 50;

export default function ContactsTable({ campaignId, filter, onFilterChange, refreshKey }) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setPage(1); }, [filter, debounced]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await listCampaignContacts(campaignId, { filter, search: debounced, page, limit: PAGE_SIZE });
      setData({ rows: res.data.data, total: res.data.pagination.total, totalPages: res.data.pagination.totalPages });
    } catch (err) {
      if (!quiet) toast.error(apiErrorMessage(err, 'Failed to load contacts'));
    } finally {
      setLoading(false);
    }
  }, [campaignId, filter, debounced, page]);

  useEffect(() => { load(); }, [load]);
  // Live refresh from the parent's polling, without the loading spinner.
  useEffect(() => { if (refreshKey) load(true); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCurrent = async () => {
    setExporting(true);
    try {
      await downloadCampaignContacts(campaignId, { type: filter, format: 'xlsx' });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Download failed'));
    } finally {
      setExporting(false);
    }
  };

  const mobile = (r) => (r.phone_number ? `${r.country_code} ${r.phone_number}` : (r.original_mobile || '—'));
  const errorText = (r) => (r.validation_status !== 'valid' ? r.validation_error : friendlyError(r));
  const columns = [
    { key: 'row_number', header: 'Row', render: (r) => <span className="text-slate-400">{r.row_number}</span> },
    { key: 'name', header: 'Name', render: (r) => r.name || <span className="text-slate-400">—</span> },
    { key: 'mobile', header: 'Mobile', render: mobile, className: 'whitespace-nowrap' },
    { key: 'status', header: 'Status', render: (r) => <ContactStatusBadge status={r.status} /> },
    { key: 'message_id', header: 'Message ID', render: (r) => <span className="font-mono text-xs break-all">{r.message_id || '—'}</span> },
    { key: 'retry_count', header: 'Retries', align: 'center' },
    {
      key: 'error',
      header: 'Error',
      render: (r) => {
        const t = errorText(r);
        return t ? <span className="text-xs text-red-700" title={r.error_message || ''}>{t}</span> : <span className="text-slate-400">—</span>;
      },
      className: 'max-w-xs',
    },
    { key: 'sent_at', header: 'Sent', render: (r) => formatDateTime(r.sent_at), className: 'whitespace-nowrap' },
    { key: 'delivered_at', header: 'Delivered', render: (r) => formatDateTime(r.delivered_at), className: 'whitespace-nowrap' },
    { key: 'read_at', header: 'Read', render: (r) => formatDateTime(r.read_at), className: 'whitespace-nowrap' },
  ];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilterChange(f.key)}
              className={`px-3 py-1.5 rounded-full text-sm border ${filter === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <SearchField value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile" />
          <Button variant="secondary" icon={Download} loading={exporting} onClick={exportCurrent} disabled={!data.total}>Export</Button>
        </div>
      </div>
      <ResponsiveTable
        columns={columns}
        rows={data.rows}
        loading={loading}
        renderCard={(r) => (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-medium">{r.name || '—'}</span>
              <ContactStatusBadge status={r.status} />
            </div>
            <div className="text-slate-600">{mobile(r)}</div>
            {errorText(r) && <div className="text-xs text-red-700">{errorText(r)}</div>}
            <div className="text-xs text-slate-400">
              Sent {formatDateTime(r.sent_at)} · Delivered {formatDateTime(r.delivered_at)} · Read {formatDateTime(r.read_at)}
            </div>
          </div>
        )}
      />
      <ListPagination page={page} totalPages={data.totalPages} total={data.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </Card>
  );
}
