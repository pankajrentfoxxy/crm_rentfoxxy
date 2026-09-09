import React from 'react';
import { X, Laptop } from 'lucide-react';
import VendorLaptopsPanel from './VendorLaptopsPanel';

export default function VendorLaptopsModal({ open, vendorId, vendorName, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Laptop className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Vendor Laptops</h3>
              <p className="text-xs text-slate-500">{vendorName || `Vendor #${vendorId}`}</p>
            </div>
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-700 p-1" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          <VendorLaptopsPanel vendorId={vendorId} vendorName={vendorName} embedded />
        </div>
      </div>
    </div>
  );
}
