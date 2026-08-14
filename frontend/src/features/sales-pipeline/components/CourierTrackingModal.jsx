import React, { useEffect, useState } from 'react';
import { Eye, ExternalLink, RefreshCw, X } from 'lucide-react';
import { getDcCourierTracking } from '../salesPipelineApi';

function formatCell(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

function TrackingDetailModal({ detail, courierName, onClose }) {
  if (!detail) return null;
  const isDl = String(detail.status_type || '').toUpperCase() === 'DL'
    || /delivered/i.test(String(detail.status || ''));

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div>
            <h4 className="font-semibold text-gray-900">Shipment details</h4>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatCell(detail.laptop || detail.ttspl_id || detail.serial_number)}
            </p>
            <p className="text-sm font-mono text-blue-700 mt-1">{formatCell(detail.awb_number)}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Courier</dt>
              <dd className="text-gray-900">{formatCell(detail.courier_name || courierName || 'BlueDart')}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Status type</dt>
              <dd className="text-gray-900 uppercase">{formatCell(detail.status_type)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-gray-500">Status</dt>
              <dd className={detail.found === false ? 'text-amber-700' : 'text-gray-900'}>
                {formatCell(detail.status)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Last updated</dt>
              <dd className="text-gray-900">
                {formatCell(detail.last_updated || [detail.status_date, detail.status_time].filter(Boolean).join(' '))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Location</dt>
              <dd className="text-gray-900">{formatCell(detail.current_location)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Origin</dt>
              <dd className="text-gray-900">{formatCell(detail.origin)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Received by</dt>
              <dd className="text-gray-900">{isDl ? formatCell(detail.received_by) : '—'}</dd>
            </div>
            {detail.serial_number ? (
              <div>
                <dt className="text-xs text-gray-500">Serial No</dt>
                <dd className="text-gray-900 font-mono text-xs">{detail.serial_number}</dd>
              </div>
            ) : null}
            {detail.ttspl_id ? (
              <div>
                <dt className="text-xs text-gray-500">TTSPL ID</dt>
                <dd className="text-gray-900 font-mono text-xs">{detail.ttspl_id}</dd>
              </div>
            ) : null}
          </dl>

          {detail.scans?.length ? (
            <div>
              <h5 className="text-sm font-medium text-gray-800 mb-2">Scan history</h5>
              <ul className="space-y-2">
                {detail.scans.map((scan, idx) => (
                  <li key={`${scan.date}-${scan.time}-${idx}`} className="border rounded-lg p-3 text-sm">
                    <p className="font-medium text-gray-900">{scan.status || '—'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {[scan.date, scan.time].filter(Boolean).join(' ')}
                      {scan.location ? ` · ${scan.location}` : ''}
                      {scan.code ? ` · ${scan.code}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No scan history available for this AWB.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CourierTrackingModal({ dcNumber, awbNumber, courierName, trackingUrl, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [viewRow, setViewRow] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getDcCourierTracking(dcNumber);
      setPayload(res.data?.data || null);
    } catch (err) {
      setPayload(null);
      setError(err.response?.data?.message || err.message || 'Failed to load tracking');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dcNumber]);

  const trackings = payload?.trackings?.length
    ? payload.trackings
    : (payload?.tracking ? [payload.tracking] : []);
  const awbList = payload?.awb_numbers?.length
    ? payload.awb_numbers
    : String(awbNumber || payload?.awb_number || '')
      .split(/[/|,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{8,}$/.test(s));
  const externalUrl = trackingUrl || payload?.courier_tracking_url || null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">Shipment Tracking</h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{dcNumber}</p>
            <p className="text-sm text-gray-700 mt-1">
              {courierName || payload?.courier_name || 'Courier'}
              {awbList.length ? (
                <>
                  {' · '}
                  {awbList.length} AWB{awbList.length > 1 ? 's' : ''}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {loading && !trackings.length ? (
            <p className="text-sm text-gray-500">Fetching BlueDart status…</p>
          ) : null}

          {error ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div>
          ) : null}

          {trackings.length > 0 ? (
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Laptop / Serial No</th>
                    <th className="px-3 py-2 font-semibold">AWB Number</th>
                    <th className="px-3 py-2 font-semibold">Courier</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Status Type</th>
                    <th className="px-3 py-2 font-semibold">Last Updated</th>
                    <th className="px-3 py-2 font-semibold">Location</th>
                    <th className="px-3 py-2 font-semibold">Received By</th>
                    <th className="px-3 py-2 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {trackings.map((row) => {
                    const isDl = String(row.status_type || '').toUpperCase() === 'DL'
                      || /delivered/i.test(String(row.status || ''));
                    return (
                      <tr
                        key={`${row.awb_number}-${row.ttspl_id || row.serial_number || ''}`}
                        className="hover:bg-slate-50"
                      >
                        <td className="px-3 py-2 text-slate-800 whitespace-nowrap">
                          {formatCell(row.laptop || row.ttspl_id || row.serial_number)}
                        </td>
                        <td className="px-3 py-2 font-mono text-blue-700 whitespace-nowrap">
                          {formatCell(row.awb_number)}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {formatCell(row.courier_name || courierName || payload?.courier_name || 'BlueDart')}
                        </td>
                        <td className={`px-3 py-2 ${row.found === false ? 'text-amber-700' : 'text-slate-900'}`}>
                          {formatCell(row.status)}
                        </td>
                        <td className="px-3 py-2 uppercase text-xs text-slate-600 whitespace-nowrap">
                          {formatCell(row.status_type)}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {formatCell(row.last_updated || [row.status_date, row.status_time].filter(Boolean).join(' '))}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {formatCell(row.current_location)}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {isDl ? formatCell(row.received_by) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setViewRow(row)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100"
                            title="View shipment details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : !loading && !error ? (
            <p className="text-sm text-gray-500">No tracking data available.</p>
          ) : null}

          {externalUrl ? (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
            >
              Open carrier tracking page <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : null}
        </div>
      </div>

      {viewRow ? (
        <TrackingDetailModal
          detail={viewRow}
          courierName={courierName || payload?.courier_name}
          onClose={() => setViewRow(null)}
        />
      ) : null}
    </div>
  );
}
