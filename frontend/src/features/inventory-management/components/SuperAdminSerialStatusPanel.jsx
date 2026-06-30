import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, ShieldAlert } from 'lucide-react';
import { updateSerialQcStatus } from '../inventoryManagementApi';
import { invalidateInventoryManagement } from '../inventoryCountsEvents';
import { invalidateQcCounts } from '../../qc-management/qcCountsEvents';

const STATUS_OPTIONS = [
  {
    value: 'out_for_repare',
    label: 'Out For Repare',
    hint: 'Shows in Inventory → Out For Repare list',
  },
  {
    value: 'pending',
    label: 'QC Process',
    hint: 'Receive back into QC queue (optionally create floor ticket)',
  },
  {
    value: 'passed',
    label: 'QC Passed',
    hint: 'Ready to Rent or Sell list',
  },
  {
    value: 'failed',
    label: 'QC Failed',
    hint: 'Failed QC list',
  },
];

export default function SuperAdminSerialStatusPanel({ row, onUpdated }) {
  const [status, setStatus] = useState('');
  const [remark, setRemark] = useState('');
  const [createFloorTicket, setCreateFloorTicket] = useState(true);
  const [saving, setSaving] = useState(false);

  if (!row?.serial_id) return null;

  const handleSave = async () => {
    if (!status) {
      toast.error('Select a status');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateSerialQcStatus(row.serial_id, {
        qc_status: status,
        remark: remark || undefined,
        create_floor_ticket: status === 'pending' ? createFloorTicket : false,
      });
      toast.success(data.message || 'Status updated');
      invalidateInventoryManagement();
      invalidateQcCounts();
      onUpdated?.();
      setStatus('');
      setRemark('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const selected = STATUS_OPTIONS.find((o) => o.value === status);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Super Admin — Fix status</p>
          <p className="text-xs text-amber-800 mt-0.5">
            Current: <strong className="capitalize">{row.qc_status?.replace(/_/g, ' ') || '—'}</strong>
            {row.status2 || row.inventory_status ? (
              <span className="ml-2 text-amber-700">
                (inventory: {String(row.status2 || row.inventory_status).replace(/_/g, ' ')})
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Set status to</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select…</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {selected ? <p className="text-[11px] text-slate-600 mt-1">{selected.hint}</p> : null}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Remark (optional)</label>
          <input
            type="text"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="Reason for correction"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </div>
      </div>

      {status === 'pending' ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={createFloorTicket}
            onChange={(e) => setCreateFloorTicket(e.target.checked)}
          />
          Create floor / production QC ticket
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving || !status}
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-700 text-white px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Update status
        </button>
        {status === 'out_for_repare' ? (
          <Link
            to="/inventory-management/out-for-repare"
            className="text-xs text-sky-700 hover:underline"
          >
            Open Out For Repare list →
          </Link>
        ) : null}
        {status === 'pending' ? (
          <Link
            to="/inventory-management/qc-process"
            className="text-xs text-sky-700 hover:underline"
          >
            Open QC Process list →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
