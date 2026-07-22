import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

function normalizeOptions(options) {
  return (options || []).map((opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: String(opt.value), label: String(opt.label ?? opt.value) };
  });
}

export default function MultiSelectFilter({
  options = [],
  value = [],
  onChange,
  allLabel,
  className = '',
}) {
  const [open, setOpen] = useState(false);

  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const optionMap = useMemo(
    () => new Map(normalizedOptions.map((opt) => [opt.value, opt.label])),
    [normalizedOptions],
  );

  const selectedValues = useMemo(
    () => (Array.isArray(value) ? value.map(String) : []),
    [value],
  );

  const displayText = selectedValues.length === 0 || selectedValues.length >= normalizedOptions.length
    ? allLabel
    : selectedValues.length === 1
      ? optionMap.get(selectedValues[0]) || selectedValues[0]
      : `${selectedValues.length} selected`;

  const allChecked = selectedValues.length === normalizedOptions.length;
  const someChecked = selectedValues.length > 0 && selectedValues.length < normalizedOptions.length;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between gap-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full mt-1 z-20 w-full min-w-[180px] bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-60 overflow-y-auto">
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someChecked;
                }}
                onChange={(e) => {
                  onChange(e.target.checked ? normalizedOptions.map((opt) => opt.value) : []);
                }}
                className="rounded"
              />
              <span>All</span>
            </label>
            {normalizedOptions.map((option) => (
              <label key={option.value} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option.value)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onChange([...new Set([...selectedValues, option.value])]);
                    } else {
                      onChange(selectedValues.filter((x) => x !== option.value));
                    }
                  }}
                  className="rounded"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
