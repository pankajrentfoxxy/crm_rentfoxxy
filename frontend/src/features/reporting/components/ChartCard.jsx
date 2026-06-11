import React from 'react';

export default function ChartCard({ title, subtitle, children, onExport }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {subtitle ? <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p> : null}
        </div>
        {onExport ? (
          <button type="button" onClick={onExport} className="text-xs text-blue-600 hover:underline shrink-0">
            Export ↓
          </button>
        ) : null}
      </div>
      <div style={{ height: 260 }}>{children}</div>
    </div>
  );
}
