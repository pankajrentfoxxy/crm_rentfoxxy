import React from 'react';
import { DISPATCH_MODE_STYLES, statusLabel } from '../salesPipelineUtils';

export default function InhouseTechnicianBucket({ buckets = [], onSendOtp, onVerifyOtp, onReject }) {
  if (!buckets.length) {
    return <p className="text-sm text-gray-500 py-8 text-center">No inhouse deliveries in transit.</p>;
  }

  return (
    <div className="space-y-6">
      {buckets.map((bucket) => (
        <div key={bucket.technician_id || bucket.name} className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-teal-50 border-b font-medium text-teal-900">
            {bucket.name || 'Unassigned'}
            <span className="ml-2 text-xs font-normal text-teal-700">({bucket.deliveries?.length || 0} active)</span>
          </div>
          {!bucket.deliveries?.length ? (
            <p className="p-4 text-sm text-gray-500">No pending deliveries</p>
          ) : (
            <ul className="divide-y">
              {bucket.deliveries.map((d) => (
                <li key={d.dc_number} className="p-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium text-gray-900">{d.customer_name}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{d.delivery_address || d.delivery_location || '—'}</p>
                    <p className="text-blue-700 font-mono text-xs mt-1">{d.dc_number}</p>
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${DISPATCH_MODE_STYLES.inhouse}`}>
                      OTP: {d.delivery_otp_sent_at ? 'Sent' : 'Not Sent'}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">{statusLabel(d.status)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => onSendOtp?.(d)} className="px-3 py-1 text-xs border rounded-lg hover:bg-gray-50">Send OTP</button>
                    <button type="button" onClick={() => onVerifyOtp?.(d)} className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg">Verify & Deliver</button>
                    <button type="button" onClick={() => onReject?.(d)} className="px-3 py-1 text-xs text-red-700 border border-red-200 rounded-lg">Reject</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
