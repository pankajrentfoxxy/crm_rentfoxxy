import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import { fetchVendor } from '../../vendor-management/vendorManagementApi';
import VendorSearchSelect, { vendorLabel } from '../../vendor-management/components/VendorSearchSelect';
import { submitReturnAndRepareCheck } from '../qcManagementApi';
import { invalidateInventoryManagement } from '../../inventory-management/inventoryCountsEvents';
import { invalidateQcCounts } from '../qcCountsEvents';

const VENDOR_REQUIRED_ACTIONS = new Set(['out_for_return', 'out_for_repare']);
const FILES_REQUIRED_ACTIONS = new Set(['out_for_return', 'out_for_repare', 'repared', 'replace']);

function actionLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ReturnRepareActionModal({
  open,
  row,
  selectedValue,
  requireVendor = false,
  onCancel,
  onSuccess
}) {
  const [remark, setRemark] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [poVendor, setPoVendor] = useState(null);
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const needsVendor = requireVendor || VENDOR_REQUIRED_ACTIONS.has(selectedValue);
  const needsFiles = FILES_REQUIRED_ACTIONS.has(selectedValue);

  useEffect(() => {
    if (!open || !row) return;
    setRemark('');
    setFiles([]);
    setVendorId(row.vendor_id != null ? String(row.vendor_id) : '');
    setPoVendor(null);
  }, [open, row, selectedValue]);

  useEffect(() => {
    if (!open || !row?.vendor_id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await fetchVendor(row.vendor_id);
        if (!cancelled && data.success && data.data) setPoVendor(data.data);
      } catch {
        if (!cancelled) {
          setPoVendor({
            vendor_id: row.vendor_id,
            f_name: row.vendor_name || `Vendor #${row.vendor_id}`
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, row?.vendor_id, row?.vendor_name]);

  const onFileChange = (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    setFiles((prev) => {
      const next = [...prev];
      picked.forEach((f) => {
        if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
      });
      return next;
    });
    e.target.value = '';
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = useCallback(async () => {
    if (!row || !selectedValue) return;
    const trimmedRemark = remark.trim();
    if (!trimmedRemark) {
      toast.error('Remark is required');
      return;
    }
    if (needsVendor && !vendorId) {
      toast.error('Please select a vendor');
      return;
    }
    if (needsFiles && files.length === 0) {
      toast.error('At least one file is required');
      return;
    }

    const formData = new FormData();
    formData.append('serial_number_id', String(row.serial_id));
    formData.append('serial_number', row.serial_number);
    formData.append('selected_value', selectedValue);
    formData.append('remark', trimmedRemark);
    if (vendorId) formData.append('vendor_id', vendorId);
    files.forEach((file) => formData.append('files', file));

    setSubmitting(true);
    try {
      const { data } = await submitReturnAndRepareCheck(formData);
      if (data.success) {
        toast.success(data.message || 'Action taken successfully!');
        invalidateQcCounts();
        invalidateInventoryManagement();
        onSuccess?.();
      } else {
        toast.error(data.message || 'Update failed');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Update failed');
    } finally {
      setSubmitting(false);
    }
  }, [row, selectedValue, remark, vendorId, needsVendor, needsFiles, files, onSuccess]);

  if (!open || !row) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel?.();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-2 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{actionLabel(selectedValue)}</h3>
            <p className="text-xs text-slate-500 mt-1 font-mono">{row.serial_number}</p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 space-y-4">
          {needsVendor ? (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-800 mb-2">Vendor Details</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-slate-500">Vendor Name</dt>
                  <dd className="font-medium text-slate-900">
                    {vendorLabel(poVendor) || row.vendor_name || '—'}
                  </dd>
                  <dt className="text-slate-500">Vendor ID</dt>
                  <dd className="font-medium text-slate-900">{row.vendor_id ?? '—'}</dd>
                  {poVendor?.email ? (
                    <>
                      <dt className="text-slate-500">Email</dt>
                      <dd className="text-slate-800">{poVendor.email}</dd>
                    </>
                  ) : null}
                  {poVendor?.phone || poVendor?.number ? (
                    <>
                      <dt className="text-slate-500">Mobile</dt>
                      <dd className="text-slate-800">{poVendor.phone || poVendor.number}</dd>
                    </>
                  ) : null}
                </dl>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="rr-vendor">
                  Select Vendor <span className="text-red-500">*</span>
                </label>
                <VendorSearchSelect
                  id="rr-vendor"
                  value={vendorId}
                  onChange={setVendorId}
                  disabled={submitting}
                />
              </div>
            </>
          ) : null}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="rr-remark">
              Remark <span className="text-red-500">*</span>
            </label>
            <textarea
              id="rr-remark"
              rows={4}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Enter remark here..."
              disabled={submitting}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600 disabled:opacity-60"
              autoFocus
            />
          </div>

          {needsFiles ? (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="rr-files">
                Upload Files <span className="text-red-500">*</span>
              </label>
              <input
                id="rr-files"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={submitting}
                onChange={onFileChange}
                className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-teal-800 file:font-medium"
              />
              {files.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {files.map((file, i) => (
                    <li
                      key={`${file.name}-${file.size}`}
                      className="flex items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1 text-xs"
                    >
                      <span className="truncate text-slate-700">{file.name}</span>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => removeFile(i)}
                        className="text-red-600 hover:underline shrink-0"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
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
            onClick={handleSubmit}
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
