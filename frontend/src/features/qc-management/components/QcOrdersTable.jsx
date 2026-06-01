import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  Clock,
  ExternalLink,
  FileImage,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  User
} from 'lucide-react';
import {
  fetchQcOrders,
  fetchQcSpareParts,
  submitHardwareQcCheck,
  submitQcCheck
} from '../qcManagementApi';
import { invalidateQcCounts } from '../qcCountsEvents';
import { QC_LIST_META } from '../qcStatusConfig';
import { getBackendOrigin } from '../../../utils/api';

const PAGE_SIZE = 100;

function fileUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  const clean = path.replace(/^\/+/, '');
  if (clean.startsWith('storage/')) return `${origin}/${clean}`;
  return `${origin}/storage/app/public/${clean}`;
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
      <p className="mb-0 mt-1 text-xs text-slate-600">
        {[processor, generation, [ram, storage].filter(Boolean).join(' | '), gpu]
          .filter(Boolean)
          .join(' | ')}
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

function PoTypeCell({ row }) {
  return (
    <div className="space-y-1 text-xs">
      <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-800">
        {row.purchase_order_type_label || '—'}
      </span>
      <div>
        <TimeBadge label={row.po_type_period?.label} />
      </div>
    </div>
  );
}

function ReceivedFromCell({ received }) {
  if (!received) return <span className="text-slate-400">—</span>;
  if (received.type === 'vendor') {
    return <span className="text-sm text-slate-700">Vendor</span>;
  }
  if (received.type === 'customer') {
    return (
      <div className="space-y-1 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-800">
          <User className="w-3 h-3" />
          {received.label}
        </span>
        <span className="block rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800 w-fit">Customer</span>
      </div>
    );
  }
  return <span className="text-sm text-slate-600">{received.label}</span>;
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

function QcSparePartsModal({
  open,
  serialNumber,
  parts,
  loading,
  search,
  onSearchChange,
  selectedIds,
  onTogglePart,
  onRemovePart,
  onCancel,
  onSubmit,
  submitting
}) {
  if (!open) return null;

  const selectedSet = new Set(selectedIds.map(String));
  const filtered = (parts || []).filter((p) =>
    String(p.name || '')
      .toLowerCase()
      .includes(String(search || '').trim().toLowerCase())
  );

  const selectedParts = (parts || []).filter((p) => selectedSet.has(String(p.id)));

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qc-spare-parts-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <h3 id="qc-spare-parts-modal-title" className="text-lg font-bold text-slate-900 text-center">
            Select Spare Parts
          </h3>
          {serialNumber ? (
            <p className="text-xs text-slate-500 mt-2 text-center font-mono">{serialNumber}</p>
          ) : null}
        </div>

        <div className="px-6 py-2">
          {selectedParts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {selectedParts.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-md bg-rose-500 text-white text-xs pl-2 pr-1 py-1"
                >
                  {p.name}
                  <button
                    type="button"
                    className="hover:text-rose-100 font-bold px-1"
                    disabled={submitting}
                    onClick={() => onRemovePart(p.id)}
                    aria-label={`Remove ${p.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Select Spare Parts"
            disabled={submitting || loading}
            className="w-full rounded-lg border-2 border-sky-200 px-3 py-2.5 text-sm focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:opacity-60"
            autoFocus
          />

          <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white">
            {loading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No spare parts found</p>
            ) : (
              <ul className="py-1">
                {filtered.map((part) => {
                  const id = String(part.id);
                  const checked = selectedSet.has(id);
                  return (
                    <li key={part.id}>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => onTogglePart(part.id)}
                        className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                          checked ? 'bg-slate-100 font-medium text-slate-900' : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        {part.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="px-6 pb-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || loading}
            onClick={onSubmit}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Submit
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function QcRemarkModal({ open, title, description, serialNumber, value, onChange, onCancel, onSubmit, submitting }) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qc-remark-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <h3 id="qc-remark-modal-title" className="text-lg font-bold text-slate-900">
            {title}
          </h3>
          {description ? <p className="text-sm text-slate-600 mt-1">{description}</p> : null}
          {serialNumber ? (
            <p className="text-xs text-slate-500 mt-2 font-mono">{serialNumber}</p>
          ) : null}
        </div>
        <div className="px-6 py-3">
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="qc-failed-remark">
            Please provide a reason for failure
          </label>
          <textarea
            id="qc-failed-remark"
            rows={4}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter remark here..."
            disabled={submitting}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600 disabled:opacity-60"
            autoFocus
          />
        </div>
        <div className="px-6 pb-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onSubmit}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Submit
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function QcStatusSelect({ row, onUpdated, options, placeholder }) {
  const [busy, setBusy] = useState(false);
  const [selectValue, setSelectValue] = useState(row.qc_status);
  const [failedModalOpen, setFailedModalOpen] = useState(false);
  const [failedRemark, setFailedRemark] = useState('');
  const [spareModalOpen, setSpareModalOpen] = useState(false);
  const [spareParts, setSpareParts] = useState([]);
  const [sparePartsLoading, setSparePartsLoading] = useState(false);
  const [selectedPartIds, setSelectedPartIds] = useState([]);
  const [spareSearch, setSpareSearch] = useState('');

  useEffect(() => {
    setSelectValue(row.qc_status);
  }, [row.qc_status, row.serial_id]);

  useEffect(() => {
    if (!spareModalOpen) return;
    let cancelled = false;
    (async () => {
      setSparePartsLoading(true);
      try {
        const { data } = await fetchQcSpareParts();
        if (!cancelled && data.success) setSpareParts(data.data || []);
      } catch {
        if (!cancelled) toast.error('Failed to load spare parts');
      } finally {
        if (!cancelled) setSparePartsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spareModalOpen]);

  const runSubmit = async (selected, remark = '', sparePartsIds = null) => {
    setBusy(true);
    try {
      const payload = {
        serial_number_id: row.serial_id,
        serial_number: row.serial_number,
        selected_value: selected
      };
      if (selected === 'require_for_parts') {
        payload.sparePartsIds =
          typeof sparePartsIds === 'string' ? sparePartsIds : JSON.stringify(sparePartsIds || []);
      } else {
        payload.remark = remark;
      }
      const { data } = await submitQcCheck(payload);
      if (data.success) {
        toast.success(data.message || 'QC updated');
        invalidateQcCounts();
        setSelectValue(selected);
        onUpdated?.();
      } else {
        toast.error(data.message || 'Update failed');
        setSelectValue(row.qc_status);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Update failed');
      setSelectValue(row.qc_status);
    } finally {
      setBusy(false);
    }
  };

  const handleChange = async (e) => {
    const selected = e.target.value;
    if (!selected || selected === row.qc_status) return;

    if (selected === 'failed') {
      setFailedRemark('');
      setFailedModalOpen(true);
      setSelectValue(row.qc_status);
      return;
    }

    if (selected === 'require_for_parts') {
      setSelectedPartIds([]);
      setSpareSearch('');
      setSpareModalOpen(true);
      setSelectValue(row.qc_status);
      return;
    }

    setSelectValue(selected);
    await runSubmit(selected, '');
  };

  const submitFailedRemark = async () => {
    if (!String(failedRemark).trim()) {
      toast.error('Remark is required for Failed');
      return;
    }
    setFailedModalOpen(false);
    await runSubmit('failed', String(failedRemark).trim());
    setFailedRemark('');
  };

  const cancelFailedRemark = () => {
    if (busy) return;
    setFailedModalOpen(false);
    setFailedRemark('');
    setSelectValue(row.qc_status);
  };

  const cancelSpareParts = () => {
    if (busy) return;
    setSpareModalOpen(false);
    setSelectedPartIds([]);
    setSpareSearch('');
    setSelectValue(row.qc_status);
  };

  const toggleSparePart = (partId) => {
    const id = String(partId);
    setSelectedPartIds((prev) =>
      prev.map(String).includes(id) ? prev.filter((x) => String(x) !== id) : [...prev, partId]
    );
  };

  const submitSpareParts = async () => {
    if (!selectedPartIds.length) {
      toast.error('Please select at least one spare part.');
      return;
    }
    const idsJson = JSON.stringify(selectedPartIds.map(String));
    setSpareModalOpen(false);
    await runSubmit('require_for_parts', '', idsJson);
    setSelectedPartIds([]);
    setSpareSearch('');
  };

  const opts = options || [
    { value: 'pending', label: 'Pending' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'dead', label: 'Dead' },
    { value: 'require_for_parts', label: 'Require For Parts' }
  ];

  return (
    <>
      <select
        className="rounded-md border border-slate-200 text-xs px-2 py-1.5 min-w-[9rem] disabled:opacity-50"
        value={selectValue}
        disabled={busy}
        onChange={handleChange}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <QcRemarkModal
        open={failedModalOpen}
        title="Enter Remark"
        description="This asset will be marked as failed."
        serialNumber={row.serial_number}
        value={failedRemark}
        onChange={setFailedRemark}
        onCancel={cancelFailedRemark}
        onSubmit={submitFailedRemark}
        submitting={busy}
      />

      <QcSparePartsModal
        open={spareModalOpen}
        serialNumber={row.serial_number}
        parts={spareParts}
        loading={sparePartsLoading}
        search={spareSearch}
        onSearchChange={setSpareSearch}
        selectedIds={selectedPartIds}
        onTogglePart={toggleSparePart}
        onRemovePart={toggleSparePart}
        onCancel={cancelSpareParts}
        onSubmit={submitSpareParts}
        submitting={busy}
      />
    </>
  );
}

function HardwareQcSelect({ row, onUpdated }) {
  const [busy, setBusy] = useState(false);

  const handleChange = async (e) => {
    const selected = e.target.value;
    if (!selected || selected === (row.hardware_action || 'pending')) return;

    let remark = '';
    if (selected === 'not_ready') {
      const input = window.prompt('Hardware remark (required for Not Ready):');
      if (input == null) {
        e.target.value = row.hardware_action || 'pending';
        return;
      }
      if (!String(input).trim()) {
        toast.error('Remark is required');
        e.target.value = row.hardware_action || 'pending';
        return;
      }
      remark = String(input).trim();
    }

    setBusy(true);
    try {
      const { data } = await submitHardwareQcCheck({
        serial_number_id: row.serial_id,
        serial_number: row.serial_number,
        selected_value: selected,
        remark
      });
      if (data.success) {
        toast.success(data.message || 'Hardware QC updated');
        invalidateQcCounts();
        onUpdated?.();
      } else {
        toast.error(data.message || 'Update failed');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      className="rounded-md border border-slate-200 text-xs px-2 py-1.5 min-w-[7rem] disabled:opacity-50"
      defaultValue={row.hardware_action || 'pending'}
      disabled={busy}
      onChange={handleChange}
    >
      <option value="pending">Pending</option>
      <option value="ready">Ready</option>
      <option value="not_ready">Not Ready</option>
    </select>
  );
}

function StatusChip({ status, variant = 'danger' }) {
  const styles =
    variant === 'success'
      ? 'bg-emerald-50 text-emerald-800'
      : variant === 'warn'
        ? 'bg-amber-50 text-amber-900'
        : 'bg-red-50 text-red-800';
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold capitalize ${styles}`}>
      {status?.replace(/_/g, ' ') || 'N/A'}
    </span>
  );
}

function useColumnCount(meta, apiStatus) {
  return useMemo(() => {
    let n = 8;
    if (meta?.showFiles) n += 1;
    if (meta?.showPendingExtras) n += 5;
    else if (meta?.showRequireParts) n += 2;
    else if (meta?.showPassedAction) n += 2;
    else if (meta?.showFailedExtras) n += 3;
    else if (meta?.showDeadExtras) n += 3;
    else n += 1;
    return n;
  }, [meta, apiStatus]);
}

export default function QcOrdersTable({ routeKey }) {
  const meta = QC_LIST_META[routeKey];
  const apiStatus = meta?.apiStatus;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [partsModal, setPartsModal] = useState(null);
  const [spareCatalog, setSpareCatalog] = useState([]);

  const colCount = useColumnCount(meta, apiStatus);

  useEffect(() => {
    if (!partsModal) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await fetchQcSpareParts();
        if (!cancelled && data.success) setSpareCatalog(data.data || []);
      } catch {
        /* names fall back to raw ids */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partsModal]);

  const resolvePartLabel = useCallback(
    (partId) => {
      const hit = spareCatalog.find((p) => String(p.id) === String(partId));
      return hit?.name || String(partId);
    },
    [spareCatalog]
  );

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!apiStatus) return;
    setLoading(true);
    try {
      const { data } = await fetchQcOrders(apiStatus, {
        page: 1,
        limit: PAGE_SIZE,
        search: search || undefined
      });
      if (data.success) {
        setRows(data.data || []);
        setTotal(data.pagination?.total ?? (data.data || []).length);
      } else {
        toast.error(data.message || 'Failed to load list');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiStatus, search]);

  useEffect(() => {
    load();
  }, [load]);

  if (!meta) {
    return <p className="text-sm text-red-600">Unknown QC list route.</p>;
  }

  const isRentToOwn = (row) => String(row.purchase_order_type || '').toLowerCase() === 'rent_to_own';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <span>{meta.title}</span>
          <span className="text-slate-700 font-semibold">{meta.titleSuffix}</span>
          <span className="rounded-full bg-slate-100 text-slate-800 text-sm font-semibold px-3 py-0.5">
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

      <div className="rounded-xl border bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search serial, PO, vendor…"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3 whitespace-nowrap">S.No</th>
                <th className="px-3 py-3 whitespace-nowrap">Serial/Unique Number</th>
                <th className="px-3 py-3 whitespace-nowrap">PO Details</th>
                <th className="px-3 py-3 whitespace-nowrap">Item Description</th>
                <th className="px-3 py-3 whitespace-nowrap">Locking Period</th>
                <th className="px-3 py-3 whitespace-nowrap">Added Date</th>
                <th className="px-3 py-3 whitespace-nowrap">PO Type</th>
                <th className="px-3 py-3 whitespace-nowrap">Recieved From</th>
                {meta.showFiles ? <th className="px-3 py-3 whitespace-nowrap">Files</th> : null}

                {meta.showPendingExtras ? (
                  <>
                    <th className="px-3 py-3 whitespace-nowrap">Status</th>
                    <th className="px-3 py-3 whitespace-nowrap">Action Status</th>
                    <th className="px-3 py-3 whitespace-nowrap">Remark</th>
                    <th className="px-3 py-3 whitespace-nowrap">Hardware Action</th>
                    <th className="px-3 py-3 whitespace-nowrap">Hardware Remark</th>
                  </>
                ) : null}

                {meta.showRequireParts ? (
                  <>
                    <th className="px-3 py-3 whitespace-nowrap">Status</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Required Parts</th>
                  </>
                ) : null}

                {meta.showPassedAction ? (
                  <>
                    <th className="px-3 py-3 whitespace-nowrap">Status</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Action</th>
                  </>
                ) : null}

                {meta.showFailedExtras ? (
                  <>
                    <th className="px-3 py-3 whitespace-nowrap">Status</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Remark</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Action</th>
                  </>
                ) : null}

                {meta.showDeadExtras ? (
                  <>
                    <th className="px-3 py-3 whitespace-nowrap">Status</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Remark</th>
                    <th className="px-3 py-3 text-center whitespace-nowrap">Action</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-16 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-600" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center text-slate-500">
                    No data to show. Receive serials via Vendor Management to populate this list.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={row.serial_id} className="hover:bg-slate-50/60 align-top">
                    <td className="px-3 py-3 text-slate-600">{idx + 1}</td>
                    <td className="px-3 py-3">
                      <p className="mb-0 font-mono text-xs">
                        <span className="block border-b border-teal-200 text-teal-800 font-semibold pb-0.5">
                          {row.serial_number}
                        </span>
                        <span className="mt-1 block text-slate-500">{row.unique_product_serial || '—'}</span>
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="mb-0 text-xs">
                        {row.po_id ? (
                          <Link
                            to={`/vendor-management/purchase-orders/${row.po_id}/receive`}
                            className="border-b border-teal-600 text-teal-700 hover:text-teal-900 font-medium"
                            target="_blank"
                          >
                            {row.purchase_order_number}
                          </Link>
                        ) : (
                          row.purchase_order_number
                        )}
                        <br />
                        <span className="mt-1 inline-block text-slate-500">{row.grn_number}</span>
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <ItemDescriptionCard item={row.item_description} />
                    </td>
                    <td className="px-3 py-3">
                      <TimeBadge label={row.locking_period?.label} />
                    </td>
                    <td className="px-3 py-3">
                      <TimeBadge label={row.added_date?.label} />
                    </td>
                    <td className="px-3 py-3">
                      <PoTypeCell row={row} />
                    </td>
                    <td className="px-3 py-3">
                      <ReceivedFromCell received={row.received_from} />
                    </td>

                    {meta.showFiles ? (
                      <td className="px-3 py-3">
                        <FilesCell paths={row.file_paths} />
                      </td>
                    ) : null}

                    {meta.showPendingExtras ? (
                      <>
                        <td className="px-3 py-3">
                          <QcStatusSelect row={row} onUpdated={load} />
                        </td>
                        <td className="px-3 py-3">
                          <StatusChip status={row.action_status || 'N/A'} variant="warn" />
                        </td>
                        <td className="px-3 py-3 max-w-[140px]">
                          <ReadMoreText
                            text={
                              row.action_status
                                ? row.action_remark || 'N/A'
                                : row.status2 === 'qc_reject'
                                  ? row.remark
                                  : 'N/A'
                            }
                          />
                        </td>
                        <td className="px-3 py-3">
                          <HardwareQcSelect row={row} onUpdated={load} />
                        </td>
                        <td className="px-3 py-3 max-w-[140px]">
                          <ReadMoreText
                            text={
                              row.hardware_action === 'not_ready' ? row.hardware_remark : 'N/A'
                            }
                          />
                        </td>
                      </>
                    ) : null}

                    {meta.showRequireParts ? (
                      <>
                        <td className="px-3 py-3">
                          <StatusChip status="require for parts" variant="success" />
                        </td>
                        <td className="px-3 py-3 text-center">
                          {row.require_parts?.length > 0 ? (
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-teal-700 hover:bg-teal-50"
                              title="View required parts"
                              onClick={() => setPartsModal(row)}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </button>
                          ) : (
                            <QcStatusSelect
                              row={row}
                              onUpdated={load}
                              options={[{ value: 'send_to_qc_check', label: 'Send to QC check' }]}
                              placeholder="Take Action"
                            />
                          )}
                        </td>
                      </>
                    ) : null}

                    {meta.showPassedAction ? (
                      <>
                        <td className="px-3 py-3">
                          <StatusChip status="passed" variant="success" />
                        </td>
                        <td className="px-3 py-3 text-center">
                          <select
                            className="rounded-md border border-slate-200 text-xs px-2 py-1.5"
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value === 'qc_reject') {
                                toast('Return/reject flow will connect to repair API next.', { icon: 'ℹ️' });
                              }
                              e.target.value = '';
                            }}
                          >
                            <option value="">Take Action</option>
                            <option value="qc_reject">Reject</option>
                          </select>
                        </td>
                      </>
                    ) : null}

                    {meta.showFailedExtras ? (
                      <>
                        <td className="px-3 py-3">
                          <StatusChip status={row.qc_status || 'failed'} />
                        </td>
                        <td className="px-3 py-3 text-center max-w-[160px]">
                          <ReadMoreText text={row.remark} />
                        </td>
                        <td className="px-3 py-3 text-center">
                          <select
                            className="rounded-md border border-slate-200 text-xs px-2 py-1.5 min-w-[9rem]"
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) {
                                toast('Out for return/repair will connect to repair API next.', { icon: 'ℹ️' });
                              }
                              e.target.value = '';
                            }}
                          >
                            <option value="">Take Action</option>
                            {!isRentToOwn(row) ? <option value="out_for_return">Out For Return</option> : null}
                            <option value="out_for_repare">Out For Repare</option>
                          </select>
                        </td>
                      </>
                    ) : null}

                    {meta.showDeadExtras ? (
                      <>
                        <td className="px-3 py-3">
                          <StatusChip status="dead" />
                        </td>
                        <td className="px-3 py-3 text-center max-w-[160px]">
                          <ReadMoreText text={row.remark} />
                        </td>
                        <td className="px-3 py-3 text-center">
                          <QcStatusSelect
                            row={row}
                            onUpdated={load}
                            options={[{ value: 'pending', label: 'Send to qc processing' }]}
                            placeholder="Please Select"
                          />
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {partsModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-bold text-slate-900">Required Parts</h3>
            <p className="text-sm text-slate-500 mt-1 font-mono">{partsModal.serial_number}</p>
            <ul className="mt-4 list-disc pl-5 text-sm text-slate-700 space-y-1">
              {(partsModal.require_parts || []).map((p, i) => (
                <li key={i}>{resolvePartLabel(p)}</li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-6 rounded-lg bg-teal-700 text-white px-4 py-2 text-sm hover:bg-teal-800"
              onClick={() => setPartsModal(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
