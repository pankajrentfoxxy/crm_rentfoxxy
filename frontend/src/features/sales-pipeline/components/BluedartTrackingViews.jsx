import React from 'react';
import { X } from 'lucide-react';

export function formatTrackingCell(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

export function BluedartTrackingDetailModal({ detail, courierName, onClose }) {
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
              {formatTrackingCell(detail.laptop || detail.ttspl_id || detail.serial_number)}
            </p>
            <p className="text-sm font-mono text-blue-700 mt-1">{formatTrackingCell(detail.awb_number)}</p>
            {detail.dc_number ? (
              <p className="text-xs text-slate-500 mt-1 font-mono">DC {detail.dc_number}</p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Courier</dt>
              <dd className="text-gray-900">{formatTrackingCell(detail.courier_name || courierName || 'BlueDart')}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Status type</dt>
              <dd className="text-gray-900 uppercase">{formatTrackingCell(detail.status_type)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-gray-500">Status</dt>
              <dd className={detail.found === false ? 'text-amber-700' : 'text-gray-900'}>
                {formatTrackingCell(detail.status)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Last updated</dt>
              <dd className="text-gray-900">
                {formatTrackingCell(detail.last_updated || [detail.status_date, detail.status_time].filter(Boolean).join(' '))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Location</dt>
              <dd className="text-gray-900">{formatTrackingCell(detail.current_location)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Origin</dt>
              <dd className="text-gray-900">{formatTrackingCell(detail.origin)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Expected delivery</dt>
              <dd className="text-gray-900">{formatTrackingCell(detail.expected_delivery)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Received by</dt>
              <dd className="text-gray-900">{isDl ? formatTrackingCell(detail.received_by) : '—'}</dd>
            </div>
            {detail.customer_name ? (
              <div className="col-span-2">
                <dt className="text-xs text-gray-500">Customer</dt>
                <dd className="text-gray-900">{detail.customer_name}</dd>
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

export function BluedartTrackingTable({ rows, onView, courierName }) {
  if (!rows?.length) {
    return <p className="text-sm text-slate-500 py-4 text-center">No tracking results.</p>;
  }

  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-2 font-semibold">AWB</th>
            <th className="px-3 py-2 font-semibold">DC / Customer</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Last updated</th>
            <th className="px-3 py-2 font-semibold">Location</th>
            <th className="px-3 py-2 font-semibold text-right">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.awb_number} className="hover:bg-slate-50">
              <td className="px-3 py-2 font-mono text-blue-700 whitespace-nowrap">{formatTrackingCell(row.awb_number)}</td>
              <td className="px-3 py-2 text-slate-700">
                <div className="font-mono text-xs">{row.dc_number || '—'}</div>
                <div className="text-xs text-slate-500">{row.customer_name || row.sales_order_number || '—'}</div>
              </td>
              <td className={`px-3 py-2 ${row.found === false ? 'text-amber-700' : 'text-slate-900'}`}>
                {formatTrackingCell(row.status)}
              </td>
              <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                {formatTrackingCell(row.last_updated || [row.status_date, row.status_time].filter(Boolean).join(' '))}
              </td>
              <td className="px-3 py-2 text-slate-700">{formatTrackingCell(row.current_location)}</td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onView(row)}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
