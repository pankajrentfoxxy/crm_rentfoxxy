import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Upload, FileSpreadsheet, Download, CheckCircle, AlertTriangle, Copy, Users,
} from 'lucide-react';
import { Button, Card, StatCard } from '../../../components/ui/primitives';
import { importCampaignContacts, downloadCampaignContacts, apiErrorMessage } from '../whatsappCampaignApi';
import { formatDateTime, formatNumber } from '../campaignStatus';

const ACCEPT = '.xlsx,.xls,.csv';

export function ImportSummary({ campaignId, summary }) {
  const [downloading, setDownloading] = useState('');
  if (!summary) return null;
  const rejected = (summary.invalid_rows ?? summary.invalid ?? 0) + (summary.duplicate_rows ?? summary.duplicate ?? 0);
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
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total rows" value={formatNumber(summary.total_rows ?? summary.total)} icon={Users} tone="blue" />
        <StatCard label="Valid" value={formatNumber(summary.valid_rows ?? summary.valid)} icon={CheckCircle} tone="green" />
        <StatCard
          label="Invalid"
          value={formatNumber(summary.invalid_rows ?? summary.invalid)}
          icon={AlertTriangle}
          tone="red"
          hint={(summary.empty_rows ?? summary.empty) ? `incl. ${summary.empty_rows ?? summary.empty} empty row(s)` : undefined}
        />
        <StatCard label="Duplicates" value={formatNumber(summary.duplicate_rows ?? summary.duplicate)} icon={Copy} tone="amber" />
      </div>
      {rejected > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>{formatNumber(rejected)} row(s) will not be sent.</span>
          <Button variant="secondary" size="sm" icon={Download} loading={downloading === 'xlsx'} onClick={() => download('xlsx')}>
            Download invalid &amp; duplicates (.xlsx)
          </Button>
          <Button variant="ghost" size="sm" loading={downloading === 'csv'} onClick={() => download('csv')}>.csv</Button>
        </div>
      )}
    </div>
  );
}

export default function ImportContactsPanel({
  campaign, latestImport, imports = [], config, onImported, disabled = false,
}) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const maxMb = config?.maxFileMb || 5;

  const pick = (e) => {
    const f = e.target.files?.[0];
    setError('');
    if (!f) return;
    const ext = f.name.toLowerCase().split('.').pop();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setError('Only .xlsx, .xls and .csv files are allowed');
      setFile(null);
      return;
    }
    if (f.size > maxMb * 1024 * 1024) {
      setError(`File is larger than ${maxMb} MB`);
      setFile(null);
      return;
    }
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

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-900">Contacts</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Upload .xlsx, .xls or .csv (max {maxMb} MB, {formatNumber(config?.maxRows || 50000)} rows) with <b>Name</b> and{' '}
          <b>Mobile</b> columns. Headers are matched case-insensitively; Phone / WhatsApp also work for Mobile.
          Extra columns can be used as template variables. Uploading again replaces the current list.
        </p>
      </div>

      {!disabled && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex-1 flex items-center gap-3 border-2 border-dashed border-slate-300 rounded-xl px-4 py-3 cursor-pointer hover:border-blue-400">
            <FileSpreadsheet className="w-6 h-6 text-slate-400 shrink-0" />
            <span className="text-sm text-slate-600 truncate">{file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : 'Choose a file…'}</span>
            <input ref={inputRef} type="file" accept={ACCEPT} onChange={pick} className="hidden" />
          </label>
          <Button icon={Upload} onClick={upload} disabled={!file} loading={uploading}>
            {uploading && progress < 100 ? `Uploading ${progress}%` : uploading ? 'Validating…' : 'Upload & validate'}
          </Button>
        </div>
      )}
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {latestImport && (
        <>
          <p className="text-xs text-slate-500">
            Last import: <b>{latestImport.file_name}</b> · {formatDateTime(latestImport.imported_at)}
            {latestImport.imported_by_name ? ` · ${latestImport.imported_by_name}` : ''}
            {latestImport.columns?.length ? ` · Columns: ${latestImport.columns.map((c) => c.label).join(', ')}` : ''}
          </p>
          <ImportSummary campaignId={campaign.id} summary={latestImport} />
        </>
      )}

      {imports.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">Import history ({imports.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500 text-left">
                <tr>
                  <th className="py-1 pr-3">File</th><th className="pr-3">Total</th><th className="pr-3">Valid</th>
                  <th className="pr-3">Invalid</th><th className="pr-3">Duplicate</th><th className="pr-3">Imported</th><th>By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td className="py-1 pr-3">{i.file_name}</td>
                    <td className="pr-3">{i.total_rows}</td>
                    <td className="pr-3">{i.valid_rows}</td>
                    <td className="pr-3">{i.invalid_rows}</td>
                    <td className="pr-3">{i.duplicate_rows}</td>
                    <td className="pr-3">{formatDateTime(i.imported_at)}</td>
                    <td>{i.imported_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}
