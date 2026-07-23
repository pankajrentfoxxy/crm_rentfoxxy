import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useLocation } from 'react-router-dom';
import { Clock, ExternalLink, FileImage, FileSpreadsheet, FileText, History, Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { SearchField, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import { useUrlFilters, useDebouncedUrlSearch, listReturnState } from '../../../hooks/useUrlFilters';
import { useAuth } from '../../../context/AuthContext';
import usePermission from '../../../hooks/usePermission';
import ItemDescriptionEditModal from './ItemDescriptionEditModal';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import AddLaptopToQcModal from './AddLaptopToQcModal';
import {
  createProductionTicket,
  fetchInventoryList,
  fetchInventoryListCounts,
  exportInventoryListExcel,
  movePassedToQcProcess,
  moveQcPendingToQcProcess,
  moveDeadToQcProcess,
  tagInventorySerial,
  updateInventorySerialRemark,
  updateReadyToRentSaleAction
} from '../inventoryManagementApi';
import {
  INVENTORY_API_SEGMENT_BY_ROUTE,
  INVENTORY_PAGE_META,
  OUT_FOR_REPAIR_INVENTORY_ACTIONS,
  READY_TO_RENT_SALE_ACTIONS
} from '../inventoryStatusConfig';
import { invalidateInventoryManagement } from '../inventoryCountsEvents';
import { invalidateQcCounts } from '../../qc-management/qcCountsEvents';
import { INVENTORY_LIST_INVALIDATE } from '../inventoryCountsEvents';
import ReturnRepareActionModal from '../../qc-management/components/ReturnRepareActionModal';
import InventorySpecFilterBar from './InventorySpecFilterBar';
import { EMPTY_SPEC_FILTERS, SPEC_FILTER_KEYS } from '../inventorySpecFilters';
import useDebouncedSpecParams from '../hooks/useDebouncedSpecParams';
import { getBackendOrigin } from '../../../utils/api';
import { salesOrderDetailPath } from '../../sales-pipeline/salesOrderScope';

const PAGE_SIZE = 25;
const INVENTORY_FILTER_DEFAULTS = {
  page: 1,
  search: '',
  dateFrom: '',
  dateTo: '',
  qcStage: 'all',
  ...EMPTY_SPEC_FILTERS,
};

function InventoryTableSkeleton({ colSpan = 12, rows = 8 }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="animate-pulse">
          <td colSpan={colSpan} className="px-3 py-3">
            <div className="h-4 bg-slate-100 rounded w-full" />
          </td>
        </tr>
      ))}
    </>
  );
}

/** Dashboard stat cards on Ready to Rent/Sell — link to the list that owns each bucket. */
const READY_TO_RENT_STAT_CARDS = [
  { label: 'QC Passed Available', countKey: 'passed' },
  { label: 'QC Pending', countKey: 'qc_pending', to: '/inventory-management/qc-pending' },
  { label: 'Currently Rented', countKey: 'rented', to: '/inventory-management/customer-assets?status=rented' },
  { label: 'Sold', countKey: 'sold', to: '/inventory-management/customer-assets?status=sold' },
  { label: 'In Repair', countKey: 'out_for_repare', to: '/inventory-management/out-for-repare' },
  { label: 'In QC', countKey: 'qc_process', to: '/inventory-management/qc-process' },
  { label: 'Dead', countKey: 'dead_laptops', to: '/inventory-management/dead-laptops' },
  { label: 'Missing', countKey: 'missing_laptops', to: '/inventory-management/missing-laptops' },
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

function ItemDescriptionCell({ row, canEdit, onUpdated }) {
  const [open, setOpen] = useState(false);
  const item = row.item_description || {};

  return (
    <>
      <div className="relative">
        <ItemDescriptionCard item={item} />
        {canEdit ? (
          <button
            type="button"
            className="absolute top-1 right-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-teal-700"
            title="Edit item description"
            onClick={() => setOpen(true)}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>

      <ItemDescriptionEditModal
        open={open}
        row={row}
        onClose={() => setOpen(false)}
        onSaved={onUpdated}
      />
    </>
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

function soScopeFromQuotationType(type) {
  const key = String(type || '').toLowerCase();
  return key === 'sale' || key === 'sales' ? 'sale' : 'rental';
}

function SoAttachedBadge({ attachment, returnState }) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!attachment?.sales_order_number) return null;

  const scope = soScopeFromQuotationType(attachment.quotation_type);
  const soPath = salesOrderDetailPath(attachment.sales_order_number, scope);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 border border-amber-200 hover:bg-amber-100"
      >
        SO Attached
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Sales Order</p>
          <Link
            to={soPath}
            state={returnState}
            className="mt-1 block text-xs font-semibold text-sky-700 hover:underline break-all"
            onClick={() => setOpen(false)}
          >
            {attachment.sales_order_number}
          </Link>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Customer</p>
          <p className="mt-1 text-xs text-slate-800">
            {attachment.customer_name || '—'}
          </p>
        </div>
      ) : null}
    </div>
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

function InventoryTagButtons({ row, onUpdated, canEditTag = false }) {
  const [saving, setSaving] = useState(false);
  const tag = normalizeTag(row.inventory_tag || row.extra?.inventory_tag);

  const applyTag = async (next) => {
    if (!canEditTag) return;
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
      {canEditTag ? TAG_OPTIONS.map((opt) => (
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
      )) : null}
    </div>
  );
}

function InventoryRemarkCell({ row, canEdit, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(row.remark || row.action_remark || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setText(row.remark || row.action_remark || '');
  }, [open, row.remark, row.action_remark]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await updateInventorySerialRemark(row.serial_id, text);
      if (data.success) {
        toast.success(data.message || 'Remark saved');
        setOpen(false);
        onUpdated?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save remark');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-start gap-1 max-w-[180px]">
        <ReadMoreText text={row.remark || row.action_remark} />
        {canEdit ? (
          <button
            type="button"
            className="shrink-0 p-1 rounded hover:bg-slate-100 text-slate-500"
            title="Edit remark"
            onClick={() => setOpen(true)}
          >
            <Pencil className="w-3 h-3" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">Edit remark</h3>
              <button type="button" className="p-2 rounded-lg hover:bg-slate-100" onClick={() => setOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <p className="text-xs font-mono text-slate-500 mb-2">{row.unique_product_serial || row.serial_number}</p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Notes about this laptop…"
              />
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
              <button type="button" className="flex-1 rounded-lg border border-slate-200 py-2 text-sm" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="flex-1 rounded-lg bg-teal-700 text-white py-2 text-sm font-semibold disabled:opacity-50" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

async function moveSerialToQcProcess(row) {
  const { data } = await movePassedToQcProcess({
    serial_number_id: row.serial_id,
    serial_number: row.serial_number
  });
  if (!data.success) {
    throw new Error(data.message || 'Failed to move to QC Process');
  }
  invalidateInventoryManagement();
  invalidateQcCounts();
  return data;
}

function MoveFromQcPendingButton({ row, onUpdated }) {
  const [saving, setSaving] = useState(false);

  const handleClick = async () => {
    const ttspl = row.unique_product_serial || row.inventory_asset_code || row.serial_number;
    if (!window.confirm(`Move ${ttspl} to QC Process?\n\nA Production/Floor ticket will be created.`)) {
      return;
    }
    setSaving(true);
    try {
      const { data } = await moveQcPendingToQcProcess({
        serial_number_id: row.serial_id,
        serial_number: row.serial_number
      });
      if (!data.success) throw new Error(data.message || 'Failed');
      toast.success(data.message || 'Moved to QC Process');
      invalidateInventoryManagement();
      invalidateQcCounts();
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to move to QC Process');
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saving}
      className="inline-flex items-center justify-center rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50 whitespace-nowrap"
    >
      {saving ? 'Moving…' : 'Move to QC Process'}
    </button>
  );
}

function MoveDeadToQcProcessButton({ row, onUpdated }) {
  const [saving, setSaving] = useState(false);

  const handleClick = async () => {
    const ttspl = row.unique_product_serial || row.inventory_asset_code || row.serial_number;
    if (!window.confirm(`Send ${ttspl} to floor for re-evaluation?\n\nA Production/Floor ticket will be created.`)) {
      return;
    }
    setSaving(true);
    try {
      const { data } = await moveDeadToQcProcess({
        serial_number_id: row.serial_id,
        serial_number: row.serial_number
      });
      if (!data.success) throw new Error(data.message || 'Failed');
      toast.success(data.message || 'Sent to QC Process');
      invalidateInventoryManagement();
      invalidateQcCounts();
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to send to QC Process');
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saving}
      className="inline-flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap"
    >
      {saving ? 'Sending…' : 'Send to QC Process'}
    </button>
  );
}

function MoveToQcProcessButton({ row, onUpdated }) {
  const [saving, setSaving] = useState(false);

  const handleClick = async () => {
    const ttspl = row.unique_product_serial || row.inventory_asset_code || row.serial_number;
    if (!window.confirm(`Move ${ttspl} to QC Process?\n\nA Production/Floor ticket will be created if one does not already exist.`)) {
      return;
    }
    setSaving(true);
    try {
      const data = await moveSerialToQcProcess(row);
      toast.success(data.message || 'Moved to QC Process');
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to move to QC Process');
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saving}
      className="inline-flex items-center justify-center rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50 whitespace-nowrap"
    >
      {saving ? 'Moving…' : 'Move to QC Process'}
    </button>
  );
}

async function createProductionTicketForRow(row) {
  const { data } = await createProductionTicket({
    serial_number_id: row.serial_id,
    serial_number: row.serial_number
  });
  if (!data.success) {
    throw new Error(data.message || 'Failed to create Production ticket');
  }
  invalidateInventoryManagement();
  invalidateQcCounts();
  return data;
}

function CreateProductionTicketButton({ row, onUpdated, returnState }) {
  const [saving, setSaving] = useState(false);
  const activeTicketId = row.active_floor_ticket_id;

  if (activeTicketId) {
    return (
      <span className="text-[11px] text-slate-500 whitespace-nowrap">
        Ticket{' '}
        <Link
          to={`/floor-pipeline/tickets/${activeTicketId}`}
          state={returnState}
          className="font-semibold text-blue-700 hover:underline"
        >
          #{activeTicketId}
        </Link>{' '}
        active
      </span>
    );
  }

  const handleClick = async () => {
    const ttspl = row.unique_product_serial || row.inventory_asset_code || row.serial_number;
    if (
      !window.confirm(
        `Create Production ticket for ${ttspl}?\n\nConfiguration will be copied from the PO line item.`
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const data = await createProductionTicketForRow(row);
      toast.success(data.message || 'Production ticket created');
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to create Production ticket');
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saving}
      className="inline-flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
    >
      {saving ? 'Creating…' : 'Create Production Ticket'}
    </button>
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
  const { user } = useAuth();
  const { canEdit: canEditSection } = usePermission();
  const location = useLocation();
  const isInventoryAdmin = ['admin', 'super_admin'].includes(user?.role);
  const isSuperAdmin = user?.role === 'super_admin';
  const canEditInventory = canEditSection('inventory_management');
  const canEditQc = canEditSection('qc_management');
  const meta = INVENTORY_PAGE_META[routeKey];
  const apiSegment = INVENTORY_API_SEGMENT_BY_ROUTE[routeKey];
  const isSpare = routeKey === 'spare-parts';
  const showQcAddLaptop = ['qc-process', 'qc-pending'].includes(routeKey) && isInventoryAdmin;
  const isQcPending = routeKey === 'qc-pending';
  const isDeadLaptops = routeKey === 'dead-laptops';
  const isMissingLaptops = routeKey === 'missing-laptops';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const listAbortRef = useRef(null);
  const hasLoadedOnceRef = useRef(false);
  const { filters, setFilters } = useUrlFilters(INVENTORY_FILTER_DEFAULTS);
  const { page, dateFrom, dateTo, qcStage: qcStageFilter } = filters;
  const { searchInput, setSearchInput, debouncedSearch: search } = useDebouncedUrlSearch(filters, setFilters);
  const specFilters = useMemo(() => {
    const out = { ...EMPTY_SPEC_FILTERS };
    SPEC_FILTER_KEYS.forEach((k) => { out[k] = filters[k] || ''; });
    return out;
  }, [filters]);
  const showDateFilter = ['qc-process', 'ready-to-rent-or-sell'].includes(routeKey);
  const showSpecFilter = showDateFilter;
  const debouncedSpecParams = useDebouncedSpecParams(specFilters);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [listCounts, setListCounts] = useState(null);
  const [historyTtspl, setHistoryTtspl] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showAddLaptopModal, setShowAddLaptopModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [scopeNote, setScopeNote] = useState(null);
  const isQcProcess = routeKey === 'qc-process';
  const showReadyToRentAction = routeKey === 'ready-to-rent-or-sell';
  const canEditItemDescription =
    (showReadyToRentAction && canEditInventory)
    || (isQcProcess && (canEditInventory || canEditQc));
  const listReturn = listReturnState(location);

  const total = pagination.total || 0;

  const load = useCallback(async () => {
    if (!apiSegment) return;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    const isInitial = !hasLoadedOnceRef.current;
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    try {
      const { data } = await fetchInventoryList(apiSegment, {
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        date_from: showDateFilter && dateFrom ? dateFrom : undefined,
        date_to: showDateFilter && dateTo ? dateTo : undefined,
        ...(isQcProcess && qcStageFilter === 'qc1_qc2' ? { ticket_stage_filter: 'qc1_qc2' } : {}),
        ...(showSpecFilter ? debouncedSpecParams : {}),
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (data.success) {
        setRows(data.data || []);
        setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
        setScopeNote(data.inventory_scope_note || null);
        setSelectedIds([]);
        hasLoadedOnceRef.current = true;
      } else {
        toast.error(data.message || 'Failed to load');
      }
    } catch (e) {
      if (controller.signal.aborted || e.code === 'ERR_CANCELED' || e.name === 'CanceledError') return;
      toast.error(e.response?.data?.message || e.message || 'Failed to load');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [apiSegment, search, page, dateFrom, dateTo, showDateFilter, showSpecFilter, debouncedSpecParams, isQcProcess, qcStageFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (routeKey !== 'ready-to-rent-or-sell') return;
    fetchInventoryListCounts()
      .then(({ data }) => {
        if (data.success) setListCounts(data.counts || data.data || data);
      })
      .catch(() => {});
  }, [routeKey]);

  useEffect(() => () => listAbortRef.current?.abort(), []);

  useEffect(() => {
    const onInvalidate = () => load();
    window.addEventListener(INVENTORY_LIST_INVALIDATE, onInvalidate);
    return () => window.removeEventListener(INVENTORY_LIST_INVALIDATE, onInvalidate);
  }, [load]);

  const statCards = useMemo(
    () => (listCounts && showReadyToRentAction
      ? READY_TO_RENT_STAT_CARDS.map((card) => ({
          ...card,
          value: listCounts[card.countKey] ?? 0
        }))
      : null),
    [listCounts, showReadyToRentAction]
  );

  if (!meta) return <p className="text-sm text-red-600">Unknown inventory route.</p>;

  const showOutForRepareExtras = routeKey === 'out-for-repare';
  const showRemarkColumn = isQcPending || isQcProcess || isDeadLaptops || isMissingLaptops;
  const showQcPendingAction = isQcPending && isInventoryAdmin;
  const showDeadReevalAction = isDeadLaptops && isInventoryAdmin;
  const showTicketStage = isQcProcess;
  const showQcCreateTicket = isQcProcess;
  const showExportExcel = ['ready-to-rent-or-sell', 'qc-process', 'qc-pending'].includes(routeKey);
  const showPassedStatus = showReadyToRentAction || ['rent-to-own', 'rental-purchase', 'direct-purchase'].includes(routeKey);
  const showTagColumn = showReadyToRentAction || routeKey === 'ready-to-rent-or-sell';
  const showLocationColumn = routeKey === 'ready-to-rent-or-sell';
  const canEditInventoryTag = isSuperAdmin && showTagColumn;

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

  const handleExportExcel = async () => {
    if (!apiSegment) return;
    setExporting(true);
    try {
      await exportInventoryListExcel(apiSegment, {
        search: search || undefined,
        date_from: showDateFilter && dateFrom ? dateFrom : undefined,
        date_to: showDateFilter && dateTo ? dateTo : undefined,
        ...(isQcProcess && qcStageFilter === 'qc1_qc2' ? { ticket_stage_filter: 'qc1_qc2' } : {}),
        ...(showSpecFilter ? debouncedSpecParams : {}),
      });
      toast.success('Excel export downloaded');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {statCards ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {statCards.map((c) => (
            <InventoryStatCard key={c.label} label={c.label} value={c.value} to={c.to} />
          ))}
        </div>
      ) : null}
      {canEditInventoryTag && selectedIds.length ? (
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
      {scopeNote ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {scopeNote}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-bold text-slate-900">
          {meta.title}
          {!isQcProcess ? (
            <>
              <span className="text-slate-600 font-semibold text-lg"> List</span>
              <span className="ml-2 rounded-full bg-slate-100 text-slate-800 text-sm font-semibold px-3 py-0.5">
                {total}
              </span>
            </>
          ) : null}
        </h2>
        {isQcProcess ? (
          <div className="ml-auto rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-blue-50 px-4 py-2 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Total records</p>
            <p className="text-2xl font-bold text-sky-900 tabular-nums">{total.toLocaleString('en-IN')}</p>
          </div>
        ) : null}
        <div className={`flex flex-wrap items-center gap-2 ${isQcProcess ? 'w-full sm:w-auto sm:ml-auto' : 'ml-auto'}`}>
          {showQcAddLaptop ? (
            <button
              type="button"
              onClick={() => setShowAddLaptopModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              <Plus className="w-4 h-4" />
              Add Laptop
            </button>
          ) : null}
          {showExportExcel ? (
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting || loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              Export Excel
            </button>
          ) : null}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>
      </div>

      {isQcProcess ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-slate-500 mr-1">QC stage</span>
          {[
            { key: 'all', label: 'All' },
            { key: 'qc1_qc2', label: 'QC1 + QC2' },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setFilters({ qcStage: opt.key })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                qcStageFilter === opt.key
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white px-2 py-2 space-y-1.5 mb-2">
        <div className="flex flex-wrap items-end gap-2">
          <SearchField
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search TTSPL, serial, PO, vendor…"
            className="min-w-[180px] flex-1 max-w-md"
          />
          {showDateFilter ? (
            <DateRangeFilter
              dateFrom={dateFrom}
              dateTo={dateTo}
              onRangeChange={(range) => setFilters(range)}
              onDateFromChange={(v) => setFilters({ dateFrom: v })}
              onDateToChange={(v) => setFilters({ dateTo: v })}
              fromLabel="Updated from"
              toLabel="Updated to"
            />
          ) : null}
        </div>
        {showSpecFilter ? (
          <InventorySpecFilterBar
            filters={specFilters}
            onChange={(next) => setFilters(next)}
            onClear={() => setFilters(Object.fromEntries(SPEC_FILTER_KEYS.map((k) => [k, ''])))}
          />
        ) : null}
      </div>

      <div className={`rounded-xl border bg-white shadow-sm overflow-x-auto relative ${refreshing ? 'opacity-80' : ''}`}>
        {refreshing ? (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full bg-white/90 border border-slate-200 px-2 py-1 text-[11px] text-slate-600 shadow-sm">
            <Loader2 className="w-3 h-3 animate-spin text-sky-600" />
            Updating…
          </div>
        ) : null}
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              {showReadyToRentAction ? <th className="px-3 py-3 w-8" /> : null}
              <th className="px-3 py-3">S.No</th>
              {!isSpare ? <th className="px-3 py-3">TTSPL</th> : null}
              {showTicketStage ? <th className="px-3 py-3">Ticket Stage</th> : null}
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
                  {showQcCreateTicket ? <th className="px-3 py-3">Action</th> : null}
                  {showQcPendingAction ? <th className="px-3 py-3">Action</th> : null}
                  {showDeadReevalAction ? <th className="px-3 py-3">Action</th> : null}
                  {showRemarkColumn ? <th className="px-3 py-3">Remark</th> : null}
                  {showLocationColumn ? <th className="px-3 py-3">Location</th> : null}
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
              <InventoryTableSkeleton colSpan={12} />
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
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setHistoryTtspl(row.unique_product_serial || row.inventory_asset_code)}
                            className="font-mono text-xs font-semibold text-blue-700 hover:underline text-left"
                          >
                            {row.unique_product_serial || row.inventory_asset_code}
                          </button>
                          {showReadyToRentAction ? (
                            <SoAttachedBadge attachment={row.so_attachment} returnState={listReturn} />
                          ) : null}
                        </div>
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
                  {showTicketStage ? (
                    <td className="px-3 py-3">
                      {row.ticket_stage_name ? (
                        row.active_floor_ticket_id ? (
                          <Link
                            to={`/floor-pipeline/tickets/${row.active_floor_ticket_id}`}
                            state={listReturn}
                            className="inline-flex rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"
                          >
                            {row.ticket_stage_name}
                          </Link>
                        ) : (
                          <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
                            {row.ticket_stage_name}
                          </span>
                        )
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
                    <ItemDescriptionCell
                      row={row}
                      canEdit={canEditItemDescription}
                      onUpdated={load}
                    />
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
                      <div className="flex flex-col gap-2 min-w-[11rem]">
                        <ReadyToRentActionSelect row={row} onUpdated={load} />
                        {isInventoryAdmin ? (
                          <MoveToQcProcessButton row={row} onUpdated={load} />
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                  {showQcCreateTicket ? (
                    <td className="px-3 py-3">
                      <CreateProductionTicketButton row={row} onUpdated={load} returnState={listReturn} />
                    </td>
                  ) : null}
                  {showQcPendingAction ? (
                    <td className="px-3 py-3">
                      <MoveFromQcPendingButton row={row} onUpdated={load} />
                    </td>
                  ) : null}
                  {showDeadReevalAction ? (
                    <td className="px-3 py-3">
                      <MoveDeadToQcProcessButton row={row} onUpdated={load} />
                    </td>
                  ) : null}
                  {showRemarkColumn ? (
                    <td className="px-3 py-3">
                      <InventoryRemarkCell row={row} canEdit={isInventoryAdmin} onUpdated={load} />
                    </td>
                  ) : null}
                  {showLocationColumn ? (
                    <td className="px-3 py-3 text-xs whitespace-nowrap">
                      {row.warehouse_location
                        || (row.warehouse_carret && row.warehouse_carret_slot
                          ? `Carret ${row.warehouse_carret} / Slot ${row.warehouse_carret_slot}`
                          : '—')}
                    </td>
                  ) : null}
                  {showTagColumn ? (
                    <td className="px-3 py-3">
                      <InventoryTagButtons row={row} onUpdated={load} canEditTag={canEditInventoryTag} />
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
        onPageChange={(p) => setFilters({ page: p })}
      />

      <TtsplHistoryDrawer
        ttsplId={historyTtspl}
        open={Boolean(historyTtspl)}
        onClose={() => setHistoryTtspl(null)}
      />

      <AddLaptopToQcModal
        open={showAddLaptopModal}
        onClose={() => setShowAddLaptopModal(false)}
        onSuccess={() => load()}
        intakeTarget={isQcPending ? 'qc_pending' : 'pending'}
      />
    </div>
  );
}
