import React, { useEffect, useState } from 'react';
import { fetchDeliveryChallan } from '../../../utils/salesManagementApi';

export default function DeliveryChallanDetailModal({ dcNumber, onClose }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dcNumber) return;
    setLoading(true);
    fetchDeliveryChallan(dcNumber)
      .then((data) => setLines(data.lines || []))
      .finally(() => setLoading(false));
  }, [dcNumber]);

  if (!dcNumber) return null;

  const header = lines[0] || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Delivery Challan Details</h3>
          <button type="button" onClick={onClose} className="text-2xl text-gray-400">&times;</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm">
            <p className="text-cyan-800 font-bold">{dcNumber}</p>
            <p className="text-gray-600 mt-1">SO: {header.sales_order_number || '—'} | Quotation: {header.quotation_number || '—'}</p>
          </div>
          {loading ? <p className="text-sm text-gray-500">Loading...</p> : null}
          {lines.map((line, i) => (
            <div key={line.id || i} className="border rounded-lg p-3 text-sm">
              <p className="font-semibold">{line.model_name} — Qty {line.quantity}</p>
              <p className="text-gray-600">{[line.processor, line.generation, line.ram, line.storage].filter(Boolean).join(' | ')}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
