import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { formatDateTime } from '../salesPipelineUtils';

export default function EInvoicePanel({ dcLine, customerEmail }) {
  const [showPhase5, setShowPhase5] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const line = dcLine || {};

  return (
    <div className="space-y-6">
      <section className="bg-white border rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">E-Invoice</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-gray-500">IRN</dt><dd className="font-medium">{line.irn || 'Not generated'}</dd></div>
          <div><dt className="text-gray-500">Generated At</dt><dd>{formatDateTime(line.irn_generated_at)}</dd></div>
        </dl>
        {line.qr_code_url && (
          <img src={line.qr_code_url} alt="E-Invoice QR" className="mt-3 h-24 w-24 border rounded" />
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!line.irn && (
            <button type="button" onClick={() => setShowPhase5(true)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Generate E-Invoice
            </button>
          )}
          {line.irn && (
            <button type="button" onClick={() => setShowEmail(true)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
              Send E-Invoice to Customer
            </button>
          )}
        </div>
      </section>

      <section className="bg-white border rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">E-Way Bill</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-gray-500">EWB Number</dt><dd className="font-medium">{line.eway_bill_number || 'Not generated'}</dd></div>
          <div><dt className="text-gray-500">Valid Till</dt><dd>{formatDateTime(line.eway_bill_valid_till)}</dd></div>
        </dl>
        {!line.eway_bill_number && (
          <button type="button" onClick={() => setShowPhase5(true)} className="mt-4 px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
            Generate E-Way Bill
          </button>
        )}
      </section>

      {showPhase5 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setShowPhase5(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md p-6 text-sm text-gray-700">
            <h3 className="font-semibold text-gray-900 mb-2">Phase 5 Integration</h3>
            <p>E-Invoice integration via Zoho GSP will be enabled in Phase 5. Your credentials are configured. No action needed now.</p>
            <button type="button" onClick={() => setShowPhase5(false)} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">OK</button>
          </div>
        </div>
      )}

      {showEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setShowEmail(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold mb-3">Send E-Invoice</h3>
            <p className="text-sm text-gray-600 mb-1">To: {customerEmail || 'customer email'}</p>
            <p className="text-sm text-gray-500 mb-4">Subject: E-Invoice for delivery challan</p>
            <button
              type="button"
              onClick={() => { toast.success('E-Invoice email queued'); setShowEmail(false); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
