import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Clock, ExternalLink, FileImage, FileText, Loader2, RefreshCw, Search } from 'lucide-react';
import { fetchInventoryList, updateReadyToRentSaleAction } from '../inventoryManagementApi';
import {
  INVENTORY_API_SEGMENT_BY_ROUTE,
  INVENTORY_PAGE_META,
  OUT_FOR_REPAIR_INVENTORY_ACTIONS,
  READY_TO_RENT_SALE_ACTIONS
} from '../inventoryStatusConfig';
import { INVENTORY_LIST_INVALIDATE } from '../inventoryCountsEvents';
import ReturnRepareActionModal from '../../qc-management/components/ReturnRepareActionModal';
import { getBackendOrigin } from '../../../utils/api';

const PAGE_SIZE = 100;

function fileUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  const clean = path.replace(/^\/+/, '');
  if (clean.startsWith('uploads/')) return `${origin}/${clean}`;
  if (clean.startsWith('storage/')) return `${origin}/${clean}`;
  return `${origin}/uploads/${clean}`;
}

function ReadMoreText({ text }) {
  const [open, setOpen] = useState(false);
  if (!text || text === 'N/A') return <span className="text-slate-400">N/A</span>;
  const words = String(text).trim().split(/\s+/);
  if (words.length <= 2) return <span className="text-xs text-slate-700">{text}</span>;
  const short = words.slice(0, 2).join(' ');
  return (
    <span className="text-xs text-slate-700">
      {open ? text : short}{' '}
      <button
        type="button"
        className="text-teal-600 hover:underline font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Read Less' : 'Read More'}
      </button>
    </span>
  );
}

function FilesCell({ paths }) {
  if (!paths?.length) return <span className="text-xs text-slate-400">No Files</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {paths.map((file, i) => {
        const url = fileUrl(file);
        const ext = (file.split('.').pop() || '').toLowerCase();
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
        const isPdf = ext === 'pdf';
        return (
          <a
            key={`${file}-${i}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={file}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-teal-700 hover:bg-teal-50"
          >
            {isImage ? <FileImage className="w-4 h-4" /> : isPdf ? <FileText className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
          </a>
        );
      })}
    </div>
  );
}

function OutForRepareInventoryActionSelect({ row, onUpdated }) {
  const [modalAction, setModalAction] = useState(null);

  return (
    <>
      <select
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs min-w-[9rem]"
        defaultValue=""
        onChange={(e) => {
          const value = e.target.value;
          if (value) setModalAction(value);
          e.target.value = '';
        }}
      >
        <option value="">Take Action</option>
        {OUT_FOR_REPAIR_INVENTORY_ACTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {modalAction ? (
        <ReturnRepareActionModal
          open
          row={row}
          selectedValue={modalAction}
          onCancel={() => setModalAction(null)}
          onSuccess={() => {
            setModalAction(null);
            onUpdated?.();
          }}
        />
      ) : null}
    </>
  );
}

function ItemDescriptionCard({ item }) {
  if (!item) return <span className="text-slate-400">—</span>;
  const { brand, model, screen_size, processor, generation, ram, storage, gpu } = item;
  const title = [brand, model].filter(Boolean).join(' - ');
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm text-sm min-w-[200px]">
      <h5 className="font-semibold text-slate-900 leading-snug">
        {title || '—'}
        {screen_size ? <span className="font-normal text-slate-600"> | {screen_size}</span> : null}
      </h5>
      <p className="mt-1 text-xs text-slate-600">
        {[processor, generation, [ram, storage].filter(Boolean).join(' | '), gpu].filter(Boolean).join(' | ')}
      </p>
    </div>
  );
}

function TimeBadge({ label }) {
  if (!label || label === '—') return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
      <Clock className="w-3 h-3 shrink-0" />
      {label}
    </span>
  );
}

function PassedStatusBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
      Passed
    </span>
  );
}

function ReadyToRentActionSelect({ row, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const current = READY_TO_RENT_SALE_ACTIONS.some((o) => o.value === row.status2) ? row.status2 : '';

  const handleChange = async (e) => {
    const selected = e.target.value;
    if (!selected || saving) return;
    setSaving(true);
    try {
      const { data } = await updateReadyToRentSaleAction({
        serial_number_id: row.serial_id,
        serial_number: row.serial_number,
        selected_value: selected
      });
      if (data.success) {
        toast.success(data.message || 'Action taken successfully!');
        onUpdated?.();
      } else {
        toast.error(data.message || 'Failed to update');
        e.target.value = current;
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to update');
      e.target.value = current;
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      key={`${row.serial_id}-${current}`}
      defaultValue={current}
      onChange={handleChange}
      disabled={saving}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs min-w-[10rem] disabled:opacity-60"
    >
      <option value="">Take Action</option>
      {READY_TO_RENT_SALE_ACTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function SparePartRow({ row }) {
  return (
    <tr className="hover:bg-slate-50/60 align-top">
      <td className="px-3 py-3 text-slate-600">{row._index}</td>
      <td className="px-3 py-3 font-mono text-xs">
        <div className="text-sky-800 font-semibold">{row.serial_number}</div>
        <div className="text-slate-500 mt-1">{row.unique_product_serial || '—'}</div>
      </td>
      <td className="px-3 py-3 text-xs">{row.purchase_order_number || '—'}</td>
      <td className="px-3 py-3 text-sm">{row.part_name}</td>
      <td className="px-3 py-3 text-xs">{row.vendor_name || '—'}</td>
      <td className="px-3 py-3 capitalize text-xs">{row.qc_status?.replace(/_/g, ' ')}</td>
    </tr>
  );
}

export default function InventoryListTable({ routeKey }) {
  const meta = INVENTORY_PAGE_META[routeKey];
  const apiSegment = INVENTORY_API_SEGMENT_BY_ROUTE[routeKey];
  const isSpare = routeKey === 'spare-parts';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!apiSegment) return;
    setLoading(true);
    try {
      const { data } = await fetchInventoryList(apiSegment, {
        page: 1,
        limit: PAGE_SIZE,
        search: search || undefined
      });
      if (data.success) {
        setRows(data.data || []);
        setTotal(data.pagination?.total ?? (data.data || []).length);
      } else {
        toast.error(data.message || 'Failed to load');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiSegment, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onInvalidate = () => load();
    window.addEventListener(INVENTORY_LIST_INVALIDATE, onInvalidate);
    return () => window.removeEventListener(INVENTORY_LIST_INVALIDATE, onInvalidate);
  }, [load]);

  if (!meta) return <p className="text-sm text-red-600">Unknown inventory route.</p>;

  const showOutForRepareExtras = routeKey === 'out-for-repare';
  const showReadyToRentAction = routeKey === 'ready-to-rent-or-sell';
  const showPassedStatus = showReadyToRentAction || ['rent-to-own', 'rental-purchase', 'direct-purchase'].includes(routeKey);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-bold text-slate-900">
          {meta.title} <span className="text-slate-600 font-semibold text-lg">List</span>
          <span className="ml-2 rounded-full bg-slate-100 text-slate-800 text-sm font-semibold px-3 py-0.5">
            {total}
          </span>
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

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search serial, PO, vendor…"
          className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm"
        />
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">S.No</th>
              {showOutForRepareExtras ? (
                <>
                  <th className="px-3 py-3">Added Date</th>
                  <th className="px-3 py-3">Vendor Name</th>
                </>
              ) : null}
              <th className="px-3 py-3">Serial/Unique Number</th>
              {!isSpare ? <th className="px-3 py-3">PO Details</th> : <th className="px-3 py-3">SPO</th>}
              <th className="px-3 py-3">{isSpare ? 'Part' : 'Item Description'}</th>
              {!isSpare ? (
                <>
                  <th className="px-3 py-3">Locking Period</th>
                  <th className="px-3 py-3">PO Type</th>
                  <th className="px-3 py-3">{showOutForRepareExtras ? 'Old Vendor Name' : 'Received From'}</th>
                  {showOutForRepareExtras ? (
                    <>
                      <th className="px-3 py-3">Files</th>
                      <th className="px-3 py-3">Remark</th>
                      <th className="px-3 py-3">Action</th>
                    </>
                  ) : null}
                  {showReadyToRentAction ? <th className="px-3 py-3">Action</th> : null}
                  <th className="px-3 py-3">Status</th>
                </>
              ) : (
                <th className="px-3 py-3">Vendor</th>
              )}
              {isSpare ? <th className="px-3 py-3">Status</th> : null}
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
                  No data — receive assets via Vendor Management and pass QC first.
                </td>
              </tr>
            ) : isSpare ? (
              rows.map((row, idx) => <SparePartRow key={row.serial_id} row={{ ...row, _index: idx + 1 }} />)
            ) : (
              rows.map((row, idx) => (
                <tr key={row.serial_id} className="hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-3">{idx + 1}</td>
                  {showOutForRepareExtras ? (
                    <>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        {row.serial_updated_at
                          ? new Date(row.serial_updated_at).toLocaleString()
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-xs">{row.vendor_name || row.received_from?.label || 'N/A'}</td>
                    </>
                  ) : null}
                  <td className="px-3 py-3">
                    <Link
                      to={`/inventory-management/serial-number-status?serial=${encodeURIComponent(row.serial_number)}`}
                      className="font-mono text-xs"
                    >
                      <span className="block text-sky-800 font-semibold border-b border-sky-100">
                        {row.serial_number}
                      </span>
                      <span className="block text-slate-500 mt-1">{row.unique_product_serial || '—'}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {row.po_id ? (
                      <Link
                        to={`/vendor-management/purchase-orders/${row.po_id}/receive`}
                        className="text-sky-700 hover:underline font-medium"
                        target="_blank"
                      >
                        {row.purchase_order_number}
                      </Link>
                    ) : (
                      row.purchase_order_number
                    )}
                    <div className="text-slate-500 mt-1">{row.grn_number}</div>
                  </td>
                  <td className="px-3 py-3">
                    <ItemDescriptionCard item={row.item_description} />
                  </td>
                  <td className="px-3 py-3">
                    <TimeBadge label={row.locking_period?.label} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="space-y-1">
                      <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800">
                        {row.purchase_order_type_label || '—'}
                      </span>
                      <TimeBadge label={row.po_type_period?.label} />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {showOutForRepareExtras
                      ? row.vendor_name || 'N/A'
                      : row.received_from?.type === 'vendor'
                        ? row.vendor_name || 'Vendor'
                        : row.received_from?.label || row.vendor_name || 'Vendor'}
                  </td>
                  {showOutForRepareExtras ? (
                    <>
                      <td className="px-3 py-3">
                        <FilesCell paths={row.file_paths} />
                      </td>
                      <td className="px-3 py-3 max-w-[160px]">
                        <ReadMoreText text={row.remark || row.action_remark} />
                      </td>
                      <td className="px-3 py-3">
                        <OutForRepareInventoryActionSelect row={row} onUpdated={load} />
                      </td>
                    </>
                  ) : null}
                  {showReadyToRentAction ? (
                    <td className="px-3 py-3">
                      <ReadyToRentActionSelect row={row} onUpdated={load} />
                    </td>
                  ) : null}
                  <td className="px-3 py-3 text-xs">
                    {showPassedStatus ? (
                      <PassedStatusBadge />
                    ) : (
                      <span className="capitalize">{row.qc_status?.replace(/_/g, ' ')}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
