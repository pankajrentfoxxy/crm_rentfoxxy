import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, DataTable, DateTime, EmptyState, FilterBar, Notice, Panel, Section, Tabs,
} from '../../../../components/carret';
import {
  importCampaignContacts, downloadCampaignContacts, listCampaignContacts, apiErrorMessage,
} from '../../../whatsapp-campaigns/whatsappCampaignApi';
import { friendlyError, formatNumber } from '../../../whatsapp-campaigns/campaignStatus';
import { ContactChip } from './campaignShared';

/**
 * The working panels of a campaign: the import (upload + validation result),
 * the progress tiles and the contacts list. Used by the new-campaign steps and
 * by the campaign record.
 */

/** A figure tile that can also be a filter (the LeadsPage tile idiom). */
function Tile({ label, value, hint, tone = 'var(--rule-strong)', onClick, active }) {
  const body = (
    <>
      <div className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>{label}</div>
      <div className="text-ink font-ui tabular-nums" style={{ fontSize: 'var(--d-title)', fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
      {hint && <div className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>{hint}</div>}
    </>
  );
  const style = {
    padding: '12px 14px',
    borderTop: `3px solid ${tone}`,
    outline: active ? '2px solid var(--accent)' : undefined,
    outlineOffset: -2,
  };
  if (!onClick) return <div className="c-card" style={style}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={Boolean(active)} className="c-card text-left" style={{ ...style, cursor: 'pointer' }}>
      {body}
    </button>
  );
}

const pick = (s, a, b) => s?.[a] ?? s?.[b] ?? 0;

export function ImportSummary({ campaignId, summary }) {
  const [downloading, setDownloading] = useState('');
  if (!summary) return null;
  const invalid = pick(summary, 'invalid_rows', 'invalid');
  const duplicate = pick(summary, 'duplicate_rows', 'duplicate');
  const empty = pick(summary, 'empty_rows', 'empty');
  const rejected = invalid + duplicate;
  const download = async (format) => {
    setDownloading(format);
    try {
      await downloadCampaignContacts(campaignId, { type: 'rejected', format });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Download failed'));
    } finally {
      setDownloading('');
    }
  };
  return (
    <div className="c-stack" style={{ gap: 12 }}>
      <div className="c-tiles">
        <Tile label="Total rows" value={formatNumber(pick(summary, 'total_rows', 'total'))} tone="var(--lc-idle)" />
        <Tile label="Valid" value={formatNumber(pick(summary, 'valid_rows', 'valid'))} tone="var(--lc-earning)" />
        <Tile label="Invalid" value={formatNumber(invalid)} tone="var(--alert-crit)" hint={empty ? `incl. ${empty} empty row(s)` : undefined} />
        <Tile label="Duplicates" value={formatNumber(duplicate)} tone="var(--alert-warn)" />
      </div>
      {rejected > 0 && (
        <div className="flex flex-wrap items-center text-ink-2 font-ui" style={{ gap: 8, fontSize: 'var(--d-base)' }}>
          <span>{formatNumber(rejected)} row(s) will not be sent.</span>
          <Button disabled={Boolean(downloading)} onClick={() => download('xlsx')}>
            {downloading === 'xlsx' ? 'Downloading…' : 'Download invalid & duplicates (.xlsx)'}
          </Button>
          <Button variant="quiet" disabled={Boolean(downloading)} onClick={() => download('csv')}>
            {downloading === 'csv' ? 'Downloading…' : '.csv'}
          </Button>
        </div>
      )}
    </div>
  );
}

const ACCEPT = '.xlsx,.xls,.csv';

export function ImportContactsPanel({ campaign, latestImport, imports = [], config, onImported }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const maxMb = config?.maxFileMb || 5;

  const choose = (e) => {
    const f = e.target.files?.[0];
    setError('');
    if (!f) return;
    const ext = f.name.toLowerCase().split('.').pop();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) { setError('Only .xlsx, .xls and .csv files are allowed'); setFile(null); return; }
    if (f.size > maxMb * 1024 * 1024) { setError(`File is larger than ${maxMb} MB`); setFile(null); return; }
    setFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    setProgress(0);
    try {
      const res = await importCampaignContacts(campaign.id, file, (ev) => {
        if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100));
      });
      toast.success(res.data?.message || 'Contacts imported');
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onImported?.(res.data?.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Import failed'));
    } finally {
      setUploading(false);
    }
  };

  let uploadLabel = 'Upload & validate';
  if (uploading) uploadLabel = progress < 100 ? `Uploading ${progress}%` : 'Validating…';

  return (
    <Section title="Contacts">
      <div className="c-stack" style={{ gap: 12 }}>
        <p className="text-ink-2 font-ui m-0" style={{ fontSize: 'var(--d-base)' }}>
          Upload .xlsx, .xls or .csv (max {maxMb} MB, {formatNumber(config?.maxRows || 50000)} rows) with <strong>Name</strong> and{' '}
          <strong>Mobile</strong> columns. Headers are matched case-insensitively; Phone / WhatsApp also work for Mobile.
          Extra columns can be used as template variables. Uploading again replaces the current list.
        </p>
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <label
            className="font-ui text-ink-2"
            style={{
              flex: '1 1 18rem', display: 'flex', alignItems: 'center', gap: 8, minHeight: 'var(--d-tap)', padding: '8px 12px',
              border: '1px dashed var(--rule-strong)', borderRadius: 'var(--d-radius)', cursor: 'pointer', background: 'var(--surface-2)',
            }}
          >
            <span className="truncate">{file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : 'Choose a file…'}</span>
            <input ref={inputRef} type="file" accept={ACCEPT} onChange={choose} className="sr-only" />
          </label>
          <Button variant="primary" onClick={upload} disabled={!file || uploading}>{uploadLabel}</Button>
        </div>
        {error && <Notice tone="crit">{error}</Notice>}

        {latestImport && (
          <>
            <p className="text-ink-3 font-ui m-0" style={{ fontSize: 'var(--d-sm)' }}>
              Last import: <strong>{latestImport.file_name}</strong> · <DateTime value={latestImport.imported_at} format="datetime" />
              {latestImport.imported_by_name ? ` · ${latestImport.imported_by_name}` : ''}
              {latestImport.columns?.length ? ` · Columns: ${latestImport.columns.map((c) => c.label).join(', ')}` : ''}
            </p>
            <ImportSummary campaignId={campaign.id} summary={latestImport} />
          </>
        )}

        {imports.length > 1 && <ImportHistory imports={imports} />}
      </div>
    </Section>
  );
}

export function ImportHistory({ imports }) {
  return (
    <details className="font-ui">
      <summary className="text-ink-2" style={{ cursor: 'pointer', fontSize: 'var(--d-base)' }}>Import history ({imports.length})</summary>
      <div style={{ marginTop: 8 }}>
        <DataTable
          columns={[
            { key: 'f', header: 'File', render: (i) => i.file_name },
            { key: 't', header: 'Total', numeric: true, render: (i) => formatNumber(i.total_rows) },
            { key: 'v', header: 'Valid', numeric: true, render: (i) => formatNumber(i.valid_rows) },
            { key: 'i', header: 'Invalid', numeric: true, render: (i) => formatNumber(i.invalid_rows) },
            { key: 'd', header: 'Duplicate', numeric: true, render: (i) => formatNumber(i.duplicate_rows) },
            { key: 'w', header: 'Imported', render: (i) => <DateTime value={i.imported_at} format="datetime" />, sub: (i) => i.imported_by_name || null },
          ]}
          rows={imports}
        />
      </div>
    </details>
  );
}

export function CampaignProgress({ stats, onFilter, activeFilter }) {
  if (!stats) return null;
  const valid = stats.valid || 0;
  const done = (stats.processed || 0) + (stats.cancelled || 0);
  const pct = stats.progressPercent || 0;
  const pctOf = (n) => (valid ? `${Math.round(((n || 0) / valid) * 100)}% of valid` : undefined);
  const tile = (label, value, tone, filter, hint) => (
    <Tile
      key={filter}
      label={label}
      value={formatNumber(value)}
      tone={tone}
      hint={hint}
      onClick={onFilter ? () => onFilter(filter) : undefined}
      active={activeFilter === filter}
    />
  );
  const notes = [
    stats.status === 'PROCESSING' ? `Sending ~${formatNumber(stats.sentLastMinute)} / minute` : null,
    stats.etaMinutes ? `about ${stats.etaMinutes} min remaining` : null,
    stats.status === 'PAUSED' ? 'Paused — remaining contacts stay queued until you resume.' : null,
    stats.cancelled ? `${formatNumber(stats.cancelled)} not sent (cancelled)` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Section title="Progress">
      <div className="c-stack" style={{ gap: 12 }}>
        <div>
          <div className="flex items-center justify-between font-ui" style={{ fontSize: 'var(--d-base)', marginBottom: 6 }}>
            <strong className="text-ink">{formatNumber(done)} / {formatNumber(valid)} done</strong>
            <span className="text-ink-2 tabular-nums">{pct}%</span>
          </div>
          <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Campaign progress" style={{ height: 10, borderRadius: 5, background: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: 'var(--lc-earning)', transition: 'width .7s' }} />
          </div>
          {notes && <p className="text-ink-3 font-ui m-0" style={{ fontSize: 'var(--d-sm)', marginTop: 6 }}>{notes}</p>}
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: 12 }}>
          {tile('Total', stats.total, 'var(--lc-closed)', 'all', `${formatNumber(valid)} valid`)}
          {tile('Queued', stats.queued, 'var(--lc-moving)', 'pending')}
          {tile('Sent', stats.sent, 'var(--lc-idle)', 'sent', pctOf(stats.sent))}
          {tile('Delivered', stats.delivered, 'var(--lc-earning)', 'delivered', pctOf(stats.delivered))}
          {tile('Read', stats.read, 'var(--lc-earning)', 'read', pctOf(stats.read))}
          {tile('Failed', stats.failed, 'var(--alert-crit)', 'failed', pctOf(stats.failed))}
        </div>
      </div>
    </Section>
  );
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'sent', label: 'Sent' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'read', label: 'Read' },
  { key: 'failed', label: 'Failed' },
  { key: 'rejected', label: 'Invalid / Duplicate' },
];
const CONTACTS_PAGE = 50;

/** One campaign's contacts, filterable, searchable, exportable; quietly refreshed by the parent's polling. */
export function ContactsPanel({ campaignId, filter, onFilterChange, refreshKey }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [filter, debounced]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setData(null);
    try {
      const res = await listCampaignContacts(campaignId, { filter, search: debounced, page, limit: CONTACTS_PAGE });
      setData({ rows: res.data.data || [], total: res.data.pagination?.total || 0, totalPages: res.data.pagination?.totalPages || 1 });
    } catch (err) {
      if (!quiet) { toast.error(apiErrorMessage(err, 'Failed to load contacts')); setData({ rows: [], total: 0, totalPages: 1 }); }
    }
  }, [campaignId, filter, debounced, page]);

  useEffect(() => { load(); }, [load]);
  // Live refresh from the parent's polling, without blanking the table.
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
    { key: 'name', header: 'Contact', render: (r) => r.name || <span className="text-ink-3">—</span>, sub: (r) => `Row ${r.row_number}` },
    { key: 'mobile', header: 'Mobile', render: (r) => <span className="whitespace-nowrap">{mobile(r)}</span> },
    { key: 'status', header: 'Status', render: (r) => <ContactChip status={r.status} />, sub: (r) => (r.retry_count ? `${r.retry_count} retr${r.retry_count === 1 ? 'y' : 'ies'}` : null) },
    {
      key: 'error',
      header: 'Problem',
      render: (r) => {
        const t = errorText(r);
        return t ? <span style={{ color: 'var(--alert-crit)' }} title={r.error_message || ''}>{t}</span> : <span className="text-ink-3">—</span>;
      },
    },
    { key: 'sent', header: 'Sent', render: (r) => <DateTime value={r.sent_at} format="datetime" />, sub: (r) => r.message_id || null },
    { key: 'delivered', header: 'Delivered', render: (r) => <DateTime value={r.delivered_at} format="datetime" /> },
    { key: 'read', header: 'Read', render: (r) => <DateTime value={r.read_at} format="datetime" /> },
  ];

  return (
    <Panel
      title="Contacts"
      actions={<Button onClick={exportCurrent} disabled={exporting || !data?.total}>{exporting ? 'Exporting…' : 'Export .xlsx'}</Button>}
      toolbar={(
        <>
          <Tabs tabs={FILTERS} value={filter} onChange={onFilterChange} />
          <FilterBar
            filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'Name or mobile' }]}
            values={{ search }}
            onChange={(k, v) => setSearch(v)}
            count={data ? `${formatNumber(data.total)} contact${data.total === 1 ? '' : 's'}` : null}
          />
        </>
      )}
    >
      {data === null ? <EmptyState title="Loading contacts…" /> : (
        <DataTable
          columns={columns}
          rows={data.rows}
          empty={<EmptyState title="No contacts here" body={debounced ? 'Clear the search or pick another tab.' : undefined} />}
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
  );
}
