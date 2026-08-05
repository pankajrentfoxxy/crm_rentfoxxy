import React, { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import { getDcCourierTracking } from '../salesPipelineApi';

export default function CourierTrackingModal({ dcNumber, awbNumber, courierName, trackingUrl, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);

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

  const tracking = payload?.tracking;
  const scans = tracking?.scans || [];
  const externalUrl = trackingUrl || payload?.courier_tracking_url || null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">Courier tracking</h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{dcNumber}</p>
            <p className="text-sm text-gray-700 mt-1">
              {courierName || payload?.courier_name || 'Courier'}
              {' · '}
              AWB: <strong className="font-mono">{awbNumber || tracking?.awb_number || '—'}</strong>
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
          {loading && !tracking ? (
            <p className="text-sm text-gray-500">Fetching BlueDart status…</p>
          ) : null}

          {error ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div>
          ) : null}

          {tracking ? (
            <>
              <div className="rounded-lg border bg-gray-50 p-3 space-y-1 text-sm">
                <p>
                  Status:{' '}
                  <strong className={tracking.found === false ? 'text-amber-700' : 'text-slate-900'}>
                    {tracking.status || '—'}
                  </strong>
                  {tracking.status_type ? (
                    <span className="ml-2 text-xs text-gray-500 uppercase">{tracking.status_type}</span>
                  ) : null}
                </p>
                {(tracking.status_date || tracking.status_time) && (
                  <p className="text-gray-600">
                    As of: {[tracking.status_date, tracking.status_time].filter(Boolean).join(' ')}
                  </p>
                )}
                {(tracking.origin || tracking.destination) && (
                  <p className="text-gray-600">
                    {tracking.origin || '—'} → {tracking.destination || '—'}
                  </p>
                )}
                {tracking.expected_delivery ? (
                  <p className="text-gray-600">Expected delivery: {tracking.expected_delivery}</p>
                ) : null}
                {tracking.pickup_date ? (
                  <p className="text-gray-600">Pickup: {tracking.pickup_date}</p>
                ) : null}
              </div>

              {scans.length > 0 ? (
                <div>
                  <h4 className="text-sm font-medium text-gray-800 mb-2">Scan history</h4>
                  <ul className="space-y-2">
                    {scans.map((scan, idx) => (
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
              ) : tracking.found !== false && !loading ? (
                <p className="text-sm text-gray-500">No scan details returned for this AWB.</p>
              ) : null}
            </>
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
    </div>
  );
}
