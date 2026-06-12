import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Clock, Loader2, Mail, Phone, RefreshCw, Search, User } from 'lucide-react';
import { fetchInventoryList, updateSparePartStatus } from '../inventoryManagementApi';
import { INVENTORY_PAGE_META, SPARE_PARTS_TABS } from '../inventoryStatusConfig';
import {
  INVENTORY_LIST_INVALIDATE,
  invalidateInventoryManagement
} from '../inventoryCountsEvents';

const PAGE_SIZE = 100;

function TimeBadge({ label }) {
  if (!label || label === '—') return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
      <Clock className="w-3 h-3 shrink-0" />
      {label}
    </span>
  );
}

function ItemDescriptionCard({ item }) {
  if (!item) return <span className="text-slate-400">—</span>;
  const brand = item.brand || '';
  const part = item.part_name || item.model || '';
  const title = [brand, part].filter(Boolean).join(' - ');
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm text-sm min-w-[160px]">
      <h5 className="font-semibold text-slate-900 leading-snug">{title || '—'}</h5>
    </div>
  );
}

function VendorReceivedCell({ row }) {
  if (!row.vendor_name && !row.vendor_email && !row.vendor_phone) {
    return <span className="text-slate-400 text-xs">Vendor</span>;
  }
  return (
    <div className="space-y-0.5 text-xs">
      <p className="font-medium text-rose-700 capitalize inline-flex items-center gap-1">
        <User className="w-3 h-3 shrink-0" />
        {row.vendor_name} (Vendor)
      </p>
      {row.vendor_email ? (
        <p className="text-slate-600 inline-flex items-center gap-1">
          <Mail className="w-3 h-3 shrink-0" />
          {row.vendor_email}
        </p>
      ) : null}
      {row.vendor_phone ? (
        <p className="text-slate-600 inline-flex items-center gap-1">
          <Phone className="w-3 h-3 shrink-0" />
          {row.vendor_phone}
        </p>
      ) : null}
    </div>
  );
}

function SpareStatusActionSelect({ row, tab, onUpdated }) {
  const [busy, setBusy] = useState(false);

  const options =
    tab === 'warehouse'
      ? [{ value: 'dead', label: 'Dead' }]
      : tab === 'dead'
        ? [{ value: 'pending', label: 'Send to spare part' }]
        : [];

  if (!options.length) return <span className="text-slate-400 text-xs">—</span>;

  return (
    <select
      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs min-w-[9rem] disabled:opacity-60"
      defaultValue=""
      disabled={busy}
      onChange={async (e) => {
        const status = e.target.value;
        if (!status) return;
        setBusy(true);
        try {
          const { data } = await updateSparePartStatus({
            serial_number_id: row.serial_id,
            serial_number: row.serial_number,
            status
          });
          if (data.success) {
            toast.success(data.message || 'Status updated successfully.');
            invalidateInventoryManagement();
            onUpdated?.();
          } else {
            toast.error(data.message || 'Update failed');
          }
        } catch (err) {
          toast.error(err.response?.data?.message || err.message || 'Update failed');
        } finally {
          setBusy(false);
          e.target.value = '';
        }
      }}
    >
      <option value="">Please select</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function SparePartsInventoryTable() {
  const meta = INVENTORY_PAGE_META['spare-parts'];
  const [tab, setTab] = useState('warehouse');
  const [rows, setRows] = useState([]);
  const [tabCounts, setTabCounts] = useState({ warehouse: 0, used: 0, dead: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchInventoryList('spare_parts', {
        page: 1,
        limit: PAGE_SIZE,
        tab,
        search: search || undefined
      });
      if (data.success) {
        setRows(data.data || []);
        if (data.tabCounts) setTabCounts(data.tabCounts);
      } else {
        toast.error(data.message || 'Failed to load');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onInvalidate = () => load();
    window.addEventListener(INVENTORY_LIST_INVALIDATE, onInvalidate);
    return () => window.removeEventListener(INVENTORY_LIST_INVALIDATE, onInvalidate);
  }, [load]);

  const isUsedTab = tab === 'used';
  const showAction = tab === 'warehouse' || tab === 'dead';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-bold text-slate-900">
          {meta?.title || 'Spare Parts'}{' '}
          <span className="text-slate-600 font-semibold text-lg">List</span>
        </h2>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-0">
        {SPARE_PARTS_TABS.map((t) => {
          const count = tabCounts[t.key] ?? 0;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
                active
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {t.label}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search serial, SPO, vendor, asset serial…"
          className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm"
        />
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">S.No</th>
              <th className="px-3 py-3">{isUsedTab ? 'Parts S/U Number' : 'Serial/Unique Number'}</th>
              <th className="px-3 py-3">{isUsedTab ? 'Parts PO Details' : 'PO Details'}</th>
              <th className="px-3 py-3">{isUsedTab ? 'Parts Item Description' : 'Item Description'}</th>
              {isUsedTab ? (
                <>
                  <th className="px-3 py-3">Asset S/U Number</th>
                  <th className="px-3 py-3">Asset PO Details</th>
                </>
              ) : null}
              <th className="px-3 py-3">Warranty</th>
              <th className="px-3 py-3">Received From</th>
              {showAction ? <th className="px-3 py-3">Action</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={12} className="py-16 text-center">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-sky-600" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-12 text-center text-slate-500">
                  No spare parts in this tab — receive via Vendor Management → Spare Parts PO.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.serial_id} className="hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-3">{idx + 1}</td>
                  <td className="px-3 py-3 font-mono text-xs">
                    <Link
                      to={`/inventory-management/universal-search?serial=${encodeURIComponent(row.serial_number)}`}
                      className="text-sky-800 font-semibold hover:underline"
                    >
                      {row.serial_number}
                    </Link>
                    {!isUsedTab && row.unique_product_serial ? (
                      <div className="text-slate-500 mt-1">{row.unique_product_serial}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {row.spo_id ? (
                      <Link
                        to={`/vendor-management/spare-parts-po/${row.spo_id}/receive`}
                        className="text-sky-700 hover:underline font-medium"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {row.purchase_order_number}
                      </Link>
                    ) : (
                      row.purchase_order_number || '—'
                    )}
                    <div className="text-slate-500 mt-1">{row.grn_number}</div>
                  </td>
                  <td className="px-3 py-3">
                    <ItemDescriptionCard item={row.item_description} />
                  </td>
                  {isUsedTab ? (
                    <>
                      <td className="px-3 py-3 font-mono text-xs">
                        <div className="text-sky-800 font-semibold">{row.main_serial_number || '—'}</div>
                        {row.main_unique_number ? (
                          <div className="text-slate-500 mt-1">{row.main_unique_number}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div>{row.asset_purchase_order_number || '—'}</div>
                        <div className="text-slate-500 mt-1">{row.asset_grn_number || '—'}</div>
                      </td>
                    </>
                  ) : null}
                  <td className="px-3 py-3">
                    <TimeBadge label={row.warranty?.label} />
                  </td>
                  <td className="px-3 py-3">
                    <VendorReceivedCell row={row} />
                  </td>
                  {showAction ? (
                    <td className="px-3 py-3">
                      <SpareStatusActionSelect row={row} tab={tab} onUpdated={load} />
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
