import React, { useEffect, useState } from 'react';
import { fetchDeliveryChallan } from '../../../utils/salesManagementApi';

export default function DeliveryChallanDetailModal({ dcNumber, onClose }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!dcNumber) return;
    setLoading(true);
    setError('');
    fetchDeliveryChallan(dcNumber)
      .then((data) => setLines(data.lines || []))
      .catch(() => {
        setLines([]);
        setError('No details found for this challan.');
      })
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
            <div className="flex items-center gap-2">
              <p className="text-cyan-800 font-bold">{dcNumber}</p>
              {header.entity_code && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${header.entity_code === 'gorefurbo' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                  {header.entity_code === 'gorefurbo' ? 'Gorefurbo' : 'Rentfoxxy'}
                </span>
              )}
            </div>
            <p className="text-gray-600 mt-1">SO: {header.sales_order_number || '—'} | Quotation: {header.quotation_number || '—'}</p>
          </div>
          {loading ? <p className="text-sm text-gray-500">Loading...</p> : null}
          {!loading && error ? <p className="text-sm text-gray-500">{error}</p> : null}
          {lines.map((line, i) => {
            const units = Array.isArray(line.serials_detail) ? line.serials_detail : [];
            return (
              <div key={line.id || i} className="border rounded-lg p-3 text-sm space-y-2">
                <p className="font-semibold">{line.model_name} — Qty {line.quantity}</p>
                {(line.remarks || '').trim() ? (
                  <p className="text-gray-700"><span className="text-gray-500">Remarks:</span> {line.remarks.trim()}</p>
                ) : null}
                {units.length === 0 ? (
                  <p className="text-gray-600">{[line.processor, line.generation, line.ram, line.storage].filter(Boolean).join(' | ') || 'No unit details'}</p>
                ) : (
                  units.map((u, ui) => {
                    const config = [u.processor, u.generation, u.ram, u.storage, u.gpu, u.screen_size].filter(Boolean).join(' | ');
                    return (
                      <div key={u.ttspl || u.serial_number || ui} className="rounded-md bg-gray-50 border border-gray-100 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="font-mono font-semibold text-gray-900">{u.ttspl || '—'}</span>
                          {u.serial_number && u.serial_number !== u.ttspl && (
                            <span className="text-xs text-gray-500">SN: <span className="font-mono">{u.serial_number}</span></span>
                          )}
                          {u.status && (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{u.status}</span>
                          )}
                        </div>
                        {config && <p className="text-gray-600 mt-0.5">{config}</p>}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
