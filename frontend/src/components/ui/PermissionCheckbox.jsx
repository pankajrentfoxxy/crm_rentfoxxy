import React from 'react';

const STATES = {
  null: { label: '—', className: 'bg-gray-100 text-gray-400 border-gray-200' },
  true: { label: '?', className: 'bg-green-100 text-green-700 border-green-200' },
  false: { label: '?', className: 'bg-red-100 text-red-600 border-red-200' },
};

export default function PermissionCheckbox({ value, onChange, disabled = false }) {
  const key = String(value);
  const current = STATES[key] || STATES.null;

  return (
    <button
      type="button"
      onClick={() => {
        const cycle = { null: true, true: false, false: null };
        onChange(cycle[key]);
      }}
      disabled={disabled}
      className={`w-8 h-8 rounded border text-xs font-medium transition-colors ${current.className} ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'
      }`}
    >
      {current.label}
    </button>
  );
}
