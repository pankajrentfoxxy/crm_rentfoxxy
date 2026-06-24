import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Clock, ExternalLink, FileImage, FileText, History, Loader2, RefreshCw } from 'lucide-react';
import { SearchField, ListPagination } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  fetchInventoryList,
  fetchInventoryListCounts,
  tagInventorySerial,
  updateReadyToRentSaleAction
} from '../inventoryManagementApi';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import {
  INVENTORY_API_SEGMENT_BY_ROUTE,
  INVENTORY_PAGE_META,
  OUT_FOR_REPAIR_INVENTORY_ACTIONS,
  READY_TO_RENT_SALE_ACTIONS
} from '../inventoryStatusConfig';
import { INVENTORY_LIST_INVALIDATE } from '../inventoryCountsEvents';
import ReturnRepareActionModal from '../../qc-management/components/ReturnRepareActionModal';
import { getBackendOrigin } from '../../../utils/api';

const PAGE_SIZE = 25;

/** Dashboard stat cards on Ready to Rent/Sell — link to the list that owns each bucket. */
const READY_TO_RENT_STAT_CARDS = [
  { label: 'QC Passed Available', countKey: 'passed' },
  { label: 'Currently Rented', countKey: 'rented', to: '/inventory-management/customer-assets?status=rented' },
  { label: 'Sold', countKey: 'sold', to: '/inventory-management/customer-assets?status=sold' },
  { label: 'In Repair', countKey: 'out_for_repare', to: '/inventory-management/out-for-repare' },
  { label: 'In QC', countKey: 'qc_process', to: '/inventory-management/qc-process' },
  { label: 'QC Failed', countKey: 'failed', to: '/qc-management/failed' }
];

function InventoryStatCard({ label, value, to }) {
  const content = (
    <>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p className="text-[10px] text-slate-500 leading-tight">{label}</p>
      {to ? (
        <p className="text-[10px] text-sky-600 font-medium mt-1 group-hover:underline">View list →</p>
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="group rounded-xl border border-gray-100 bg-white p-3 shadow-sm hover:border-sky-200 hover:bg-sky-50/40 transition-colors"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
      {content}
    </div>
  );
}

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

const TAG_OPTIONS = [
  { value: 'rental', label: 'Rental' },
  { value: 'sale', label: 'Sale' },
  { value: 'both', label: 'Both' }
];

// Legacy rows stored 'sales'; show it as 'sale'.
function normalizeTag(tag) {
  if (!tag) return null;
  return tag === 'sales' ? 'sale' : tag;
}

const TAG_BADGE_STYLES = {
  rental: 'bg-violet-100 text-violet-800',
  sale: 'bg-emerald-100 text-emerald-800',
  both: 'bg-sky-100 text-sky-800'
};

function InventoryTagButtons({ row, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const tag = normalizeTag(row.inventory_tag || row.extra?.inventory_tag);

  const applyTag = async (next) => {
    setSaving(true);
    try {
      const { data } = await tagInventorySerial(row.serial_id, next);
      if (data.success) {
        toast.success(data.message || 'Tagged');
        onUpdated?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Tag failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {tag ? (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
          TAG_BADGE_STYLES[tag] || 'bg-slate-100 text-slate-700'
        }`}>
          {tag === 'both' ? 'Rental + Sale' : tag}
        </span>
      ) : (
        <span className="text-[10px] text-slate-400">Untagged</span>
      )}
      {TAG_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={saving || tag === opt.value}
          onClick={() => applyTag(opt.value)}
          className={`text-[10px] px-2 py-0.5 rounded border hover:bg-slate-50 disabled:opacity-40 ${
            tag === opt.value ? 'border-slate-400 bg-slate-100 font-semibold' : ''
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
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
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 320);
  const [listCounts, setListCounts] = useState(null);
  const [historyTtspl, setHistoryTtspl] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => { setPage(1); }, [search]);

  const total = pagination.total || 0;

  const load = useCallback(async () => {
    if (!apiSegment) return;
    setLoading(true);
    try {
      const { data } = await fetchInventoryList(apiSegment, {
        page,
        limit: PAGE_SIZE,
        search: search || undefined
      });
      if (data.success) {
        setRows(data.data || []);
        setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
        setSelectedIds([]);
      } else {
        toast.error(data.message || 'Failed to load');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiSegment, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchInventoryListCounts()
      .then(({ data }) => {
        if (data.success) setListCounts(data.counts || data.data || data);
      })
      .catch(() => {});
  }, [rows.length]);

  useEffect(() => {
    const onInvalidate = () => load();
    window.addEventListener(INVENTORY_LIST_INVALIDATE, onInvalidate);
    return () => window.removeEventListener(INVENTORY_LIST_INVALIDATE, onInvalidate);
  }, [load]);

  if (!meta) return <p className="text-sm text-red-600">Unknown inventory route.</p>;

  const showOutForRepareExtras = routeKey === 'out-for-repare';
  const showTicketId = routeKey === 'qc-process';
  const showReadyToRentAction = routeKey === 'ready-to-rent-or-sell';
  const showPassedStatus = showReadyToRentAction || ['rent-to-own', 'rental-purchase', 'direct-purchase'].includes(routeKey);
  const showTagColumn = showReadyToRentAction || routeKey === 'ready-to-rent-or-sell';

  const bulkTag = async (tag) => {
    if (!selectedIds.length) {
      toast.error('Select rows first');
      return;
    }
    try {
      await Promise.all(selectedIds.map((id) => tagInventorySerial(id, tag)));
      toast.success(`Tagged ${selectedIds.length} item(s) as ${tag}`);
      setSelectedIds([]);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Bulk tag failed');
    }
  };

  const statCards = listCounts && showReadyToRentAction
    ? READY_TO_RENT_STAT_CARDS.map((card) => ({
        ...card,
        value: listCounts[card.countKey] ?? 0
      }))
    : null;

  return (
    <div className="space-y-4">
      {statCards ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {statCards.map((c) => (
            <InventoryStatCard key={c.label} label={c.label} value={c.value} to={c.to} />
          ))}
        </div>
      ) : null}
      {showReadyToRentAction && selectedIds.length ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => bulkTag('rental')} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white">
            Tag as Rental ({selectedIds.length})
          </button>
          <button type="button" onClick={() => bulkTag('sale')} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white">
            Tag as Sale ({selectedIds.length})
          </button>
          <button type="button" onClick={() => bulkTag('both')} className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 text-white">
            Tag as Both ({selectedIds.length})
          </button>
        </div>
      ) : null}
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

      <div className="mb-2">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search TTSPL, serial, PO, vendor…"
        />
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              {showReadyToRentAction ? <th className="px-3 py-3 w-8" /> : null}
              <th className="px-3 py-3">S.No</th>
              {!isSpare ? <th className="px-3 py-3">TTSPL</th> : null}
              {showTicketId ? <th className="px-3 py-3">Ticket ID</th> : null}
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
                  {showTagColumn ? <th className="px-3 py-3">Tagged As</th> : null}
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
              rows.map((row, idx) => <SparePartRow key={row.serial_id} row={{ ...row, _index: (page - 1) * PAGE_SIZE + idx + 1 }} />)
            ) : (
              rows.map((row, idx) => (
                <tr key={row.serial_id} className="hover:bg-slate-50/60 align-top">
                  {showReadyToRentAction ? (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.serial_id)}
                        onChange={(e) => {
                          setSelectedIds((ids) =>
                            e.target.checked
                              ? [...ids, row.serial_id]
                              : ids.filter((x) => x !== row.serial_id)
                          );
                        }}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-3">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-3 py-3">
                    {row.unique_product_serial || row.inventory_asset_code ? (
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => setHistoryTtspl(row.unique_product_serial || row.inventory_asset_code)}
                          className="font-mono text-xs font-semibold text-blue-700 hover:underline text-left"
                        >
                          {row.unique_product_serial || row.inventory_asset_code}
                        </button>
                        <button
                          type="button"
                          onClick={() => setHistoryTtspl(row.unique_product_serial || row.inventory_asset_code)}
                          className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-600"
                        >
                          <History className="w-3 h-3" /> History
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                  {showTicketId ? (
                    <td className="px-3 py-3">
                      {row.ticket_id ? (
                        <Link
                          to={`/floor-pipeline/tickets/${row.ticket_id}`}
                          className="font-mono text-xs font-semibold text-blue-700 hover:underline"
                        >
                          #{row.ticket_id}
                        </Link>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                  ) : null}
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
                  {showTagColumn ? (
                    <td className="px-3 py-3">
                      <InventoryTagButtons row={row} onUpdated={load} />
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

      <ListPagination
        page={page}
        totalPages={pagination.totalPages || 1}
        total={pagination.total || 0}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />

      <TtsplHistoryDrawer
        ttsplId={historyTtspl}
        open={Boolean(historyTtspl)}
        onClose={() => setHistoryTtspl(null)}
      />
    </div>
  );
}
