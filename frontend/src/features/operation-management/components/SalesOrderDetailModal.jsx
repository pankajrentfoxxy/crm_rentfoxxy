import React, { useEffect, useState } from 'react';
import { fetchSalesOrder } from '../../../utils/salesManagementApi';

export default function SalesOrderDetailModal({ salesOrderNumber, onClose }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!salesOrderNumber) return;
    setLoading(true);
    setError('');
    fetchSalesOrder(salesOrderNumber)
      .then((data) => setLines(data.lines || []))
      .catch(() => setError('Failed to load sales order details'))
      .finally(() => setLoading(false));
  }, [salesOrderNumber]);

  if (!salesOrderNumber) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-lg font-semibold">Sales Order Details</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
            <p className="text-xs text-cyan-700 mb-1">Sales Order Number</p>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-cyan-900">{salesOrderNumber}</h3>
              {lines[0]?.entity_code && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${lines[0].entity_code === 'gorefurbo' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                  {lines[0].entity_code === 'gorefurbo' ? 'Gorefurbo' : 'Rentfoxxy'}
                </span>
              )}
            </div>
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
                {[line.model_name, line.screen_size].filter(Boolean).join(' | ')}
              </p>
              <p className="text-sm font-semibold text-gray-800 mt-1">
                {[line.generation, line.ram, line.storage].filter(Boolean).join(' | ')}
                {line.gpu ? ` | ${line.gpu}` : ''}
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
