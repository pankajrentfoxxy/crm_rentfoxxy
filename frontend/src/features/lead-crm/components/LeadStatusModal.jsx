import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { LEAD_STATUSES, STATUS_COLORS } from '../leadConstants';
import { useLeadStages } from '../hooks/useLeadStages';
import { updateLeadStatus } from '../leadCrmApi';
import toast from 'react-hot-toast';

export default function LeadStatusModal({ open, lead, onClose, onSaved }) {
  const { stagesByStatus } = useLeadStages();
  const [status, setStatus] = useState(lead?.status || 'Pending');
  const [stage, setStage] = useState(lead?.leadStage || '');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead) {
      setStatus(lead.status);
      setStage(lead.leadStage || '');
      setRemarks('');
    }
  }, [lead, open]);

  if (!open || !lead) return null;

  const stages = stagesByStatus[status] || [];
  const showStage = stages.length > 1 && !['Demo', 'Call Back'].includes(status);
  const showRejection = status === 'Rejected';
  const statusStyle = STATUS_COLORS[status] || STATUS_COLORS.Pending;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!remarks.trim()) {
      toast.error('Remarks are required for status changes');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        status,
        lead_stage: stages.length === 1 ? stages[0] : (showStage ? stage : (showRejection ? stage : null)),
        rejection_reason: showRejection ? stage : undefined,
        notes: remarks,
      };
      if (status === 'Deal' || status === 'Demo') {
        const gst = lead.gstNumber || lead.research?.gst;
        if (gst) payload.gst_number = gst;
      }
      await updateLeadStatus(lead.leadId, payload);
      toast.success('Status updated');
      if (status === 'Deal' || status === 'Demo') {
        toast('This lead is ready to convert to customer', { icon: 'ℹ️' });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Update Lead Status</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">Current status</p>
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${statusStyle.bg} ${statusStyle.text}`}>
              {lead.status}
            </span>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">New Status</label>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setStage(''); }}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {showStage && (
            <div>
              <label className="text-sm font-medium text-gray-700">Stage</label>
              <select value={stage} onChange={(e) => setStage(e.target.value)} required
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Select stage</option>
                {stages.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          {showRejection && (
            <div>
              <label className="text-sm font-medium text-gray-700">Rejection Reason</label>
              <select value={stage} onChange={(e) => setStage(e.target.value)} required
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Select reason</option>
                {stages.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-gray-700">Remarks *</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} required rows={3}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Updating...' : 'Update Status'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
