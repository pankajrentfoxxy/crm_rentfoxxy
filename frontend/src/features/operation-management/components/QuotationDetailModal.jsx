import React, { useEffect, useState } from 'react';
import { fetchQuotation } from '../../../utils/salesManagementApi';

export default function QuotationDetailModal({ quotationNumber, onClose }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!quotationNumber) return;
    setLoading(true);
    setError('');
    fetchQuotation(quotationNumber)
      .then((data) => setLines(data.lines || []))
      .catch(() => setError('Failed to load quotation details'))
      .finally(() => setLoading(false));
  }, [quotationNumber]);

  if (!quotationNumber) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-lg font-semibold">Quotation Details</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700 mb-1">Quotation Number</p>
            <h3 className="text-lg font-bold text-amber-900">{quotationNumber}</h3>
          </div>
          {loading ? <p className="text-sm text-gray-500">Loading...</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!loading && !error && lines.length === 0 ? (
            <p className="text-sm text-gray-500">Assets details not found.</p>
          ) : null}
          {lines.map((line, index) => (
            <div key={line.id || index} className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs text-gray-500 mb-2">Assets Details {index + 1}</p>
              <p className="text-sm font-semibold text-gray-900">
                {[line.processor, line.generation].filter(Boolean).join(' | ')}
                {(line.ram || line.storage) ? ` | ${[line.ram, line.storage].filter(Boolean).join(' | ')}` : ''}
              </p>
              <p className="text-sm font-semibold text-gray-800 mt-1">
                {[line.gpu, line.screen_size].filter(Boolean).join(' | ')}
              </p>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
