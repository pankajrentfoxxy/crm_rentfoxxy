import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import { fetchVendor, fetchVendors } from '../vendorManagementApi';

const DEFAULT_LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 300;

function vendorKey(v) {
  return String(v?.vendor_id ?? v?.id ?? '');
}

function vendorLabel(v) {
  if (!v) return '';
  const id = vendorKey(v);
  return v.f_name || v.business_name || `Vendor #${id}`;
}

export default function VendorSearchSelect({
  value,
  onChange,
  disabled = false,
  placeholder = '— Select Vendor —',
  id = 'vendor-search-select',
  className = ''
}) {
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadVendors = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchVendors({
        page: 1,
        limit: DEFAULT_LIMIT,
        search: search || undefined
      });
      if (data.success) setVendors(data.data || []);
      else setVendors([]);
    } catch {
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  useEffect(() => {
    if (!value) {
      setSelectedVendor(null);
      return undefined;
    }
    const hit = vendors.find((v) => vendorKey(v) === String(value));
    if (hit) {
      setSelectedVendor(hit);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await fetchVendor(value);
        if (!cancelled && data.success && data.data) setSelectedVendor(data.data);
      } catch {
        if (!cancelled) {
          setSelectedVendor({ vendor_id: value, id: value, f_name: `Vendor #${value}` });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, vendors]);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open]);

  const displayLabel = value ? vendorLabel(selectedVendor) || `Vendor #${value}` : placeholder;

  function pick(v) {
    onChange?.(vendorKey(v));
    setSelectedVendor(v);
    setOpen(false);
    setSearchInput('');
    setSearch('');
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-left disabled:opacity-60 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600"
      >
        <span className={value ? 'text-slate-900 truncate' : 'text-slate-400 truncate'}>{displayLabel}</span>
        {loading && open ? (
          <Loader2 className="w-4 h-4 shrink-0 animate-spin text-slate-400" />
        ) : (
          <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                ref={searchRef}
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search vendor name, email, phone…"
                className="w-full rounded-md border border-slate-200 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600"
              />
            </div>
          </div>

          <ul role="listbox" className="max-h-52 overflow-y-auto py-1 text-sm">
            {loading ? (
              <li className="px-3 py-6 text-center text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-teal-600" />
              </li>
            ) : vendors.length === 0 ? (
              <li className="px-3 py-4 text-center text-slate-500 text-xs">
                {search ? 'No vendors match your search.' : 'No vendors found.'}
              </li>
            ) : (
              vendors.map((v) => {
                const vid = vendorKey(v);
                const selected = String(value) === vid;
                return (
                  <li key={vid}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => pick(v)}
                      className={`w-full text-left px-3 py-2 hover:bg-teal-50 ${
                        selected ? 'bg-teal-50 text-teal-900 font-medium' : 'text-slate-800'
                      }`}
                    >
                      <span className="block truncate">{vendorLabel(v)}</span>
                      {(v.email || v.phone) && (
                        <span className="block text-[11px] text-slate-500 truncate mt-0.5">
                          {[v.email, v.phone].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {!loading && vendors.length > 0 ? (
            <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
              Showing up to {DEFAULT_LIMIT} results{search ? ' for your search' : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { vendorKey, vendorLabel };
