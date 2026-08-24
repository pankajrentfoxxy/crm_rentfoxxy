import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { exportPartsDashboard, exportPartsDrilldown } from '../partTrackingApi';

function saveBlob(data, filename) {
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PartsExportButton({
  kind = 'dashboard',
  params = {},
  sheet = 'all',
  label = 'Export',
  filename,
  compact = false,
  disabled = false,
}) {
  const [loading, setLoading] = useState(false);

  const handleExport = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || loading) return;
    setLoading(true);
    try {
      const res = kind === 'drilldown'
        ? await exportPartsDrilldown(params)
        : await exportPartsDashboard({ ...params, sheet });
      const date = new Date().toISOString().slice(0, 10);
      saveBlob(res.data, filename || `parts_${sheet}_${date}.xlsx`);
      toast.success('Report downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={disabled || loading}
      title={label}
      className={compact
        ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50'
        : 'inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60 min-h-[44px]'}
    >
      {loading ? <Loader2 className={`animate-spin ${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} /> : <Download className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
      {label}
    </button>
  );
}
