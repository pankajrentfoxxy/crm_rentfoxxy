import React from 'react';
import PermissionGate from '../../../components/PermissionGate';

export default function DcBluedartAwbTable({
  rows = [],
  loadingKey = false,
  onDownload,
  onDownloadAll,
  onTrack,
  onCancel,
  cancelBusy = false,
  showCancel = true,
}) {
  if (!rows.length) return null;

  return (
    <div className="mt-3 border border-sky-200 rounded-lg overflow-hidden bg-sky-50/40">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-sky-100 bg-sky-50">
        <p className="text-xs font-semibold text-sky-900">
          BlueDart AWBs ({rows.length})
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onTrack && (
            <button type="button" onClick={onTrack} className="text-xs text-blue-700 underline">
              Track
            </button>
          )}
          {rows.length > 1 && onDownloadAll && (
            <button
              type="button"
              disabled={Boolean(loadingKey)}
              onClick={onDownloadAll}
              className="px-2.5 py-1 rounded-md text-xs font-semibold border border-sky-300 bg-white text-sky-900 hover:bg-sky-100 disabled:opacity-50"
            >
              {loadingKey === 'all' ? 'Preparing…' : 'Download All PDFs'}
            </button>
          )}
          {showCancel && onCancel && (
            <PermissionGate section={['sales_orders_doc', 'delivery_challans']} action="edit">
              <button
                type="button"
                disabled={cancelBusy || Boolean(loadingKey)}
                onClick={onCancel}
                className="text-xs text-red-600 underline disabled:opacity-50"
              >
                {cancelBusy ? 'Cancelling…' : (rows.length > 1 ? 'Cancel AWBs' : 'Cancel AWB')}
              </button>
            </PermissionGate>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm bg-white">
          <thead className="text-[11px] uppercase text-slate-500 bg-slate-50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Laptop</th>
              <th className="text-left px-3 py-2 font-medium">AWB number</th>
              <th className="text-right px-3 py-2 font-medium">PDF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const laptop = [row.ttspl_id, row.serial_number].filter(Boolean).join(' / ') || '—';
              const busy = loadingKey === row.awb_number;
              return (
                <tr key={row.awb_number}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-800">{laptop}</td>
                  <td className="px-3 py-2 font-mono text-xs text-blue-800">{row.awb_number}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={Boolean(loadingKey)}
                      onClick={() => onDownload?.(row.awb_number)}
                      className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                    >
                      {busy ? 'Preparing…' : 'Download PDF'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
