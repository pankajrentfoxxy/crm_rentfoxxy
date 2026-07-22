import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquarePlus, Pencil, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { formatActivityDateTime } from '../leadCrmUtils';
import { addLeadRemark, getLead, updateLeadBasic } from '../leadCrmApi';

export default function LeadListExpandPanel({
  leadId,
  user: userProp,
  loading,
  activities = [],
  onRemarkSaved,
}) {
  const { user: authUser, hasPermission, isAssignedDataOnly } = useAuth();
  const user = userProp || authUser;

  const [lead, setLead] = useState(null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [remarkText, setRemarkText] = useState('');
  const [savingRemark, setSavingRemark] = useState(false);
  const [personalRemarks, setPersonalRemarks] = useState('');
  const [savingPersonalRemarks, setSavingPersonalRemarks] = useState(false);
  const [editingPersonalRemarks, setEditingPersonalRemarks] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const currentUserId = user?.user_id ?? user?.userId;
  const assignedId = lead?.assignedUserId ?? lead?.assigned_user_id;
  const role = String(user?.role || '').toLowerCase();

  // Prefer RBAC (matches production permission matrix). Fall back to roles used locally.
  const canEditByPermission = typeof hasPermission === 'function' && hasPermission('leads', 'edit');
  const canEditByRole = ['super_admin', 'admin', 'manager', 'sales'].includes(role);
  const assignedOnly = typeof isAssignedDataOnly === 'function' && isAssignedDataOnly('leads');
  const isAssignee =
    assignedId == null || String(assignedId) === String(currentUserId);

  const canEditPersonalRemarks =
    (canEditByPermission || canEditByRole) && (!assignedOnly || isAssignee);

  const canAddRemark = canEditPersonalRemarks;

  const loadLead = useCallback(async () => {
    if (!leadId) return;
    setLeadLoading(true);
    setLoadError(null);
    try {
      const { data } = await getLead(leadId);
      const next = data?.lead || data;
      setLead(next || null);
      setPersonalRemarks(next?.personalRemarks ?? next?.personal_remarks ?? '');
      setEditingPersonalRemarks(false);
    } catch (err) {
      setLoadError(err.response?.data?.message || 'Failed to load lead remarks');
      toast.error(err.response?.data?.message || 'Failed to load lead remarks');
    } finally {
      setLeadLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadLead();
  }, [loadLead]);

  const handleSavePersonalRemarks = async () => {
    setSavingPersonalRemarks(true);
    try {
      const { data } = await updateLeadBasic(leadId, { personal_remarks: personalRemarks });
      const updated = data?.lead;
      const saved =
        updated?.personalRemarks ?? updated?.personal_remarks ?? personalRemarks;
      setLead((prev) => ({ ...(prev || {}), personalRemarks: saved, personal_remarks: saved }));
      setPersonalRemarks(saved || '');
      setEditingPersonalRemarks(false);
      toast.success('Personal remarks saved');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save personal remarks');
    } finally {
      setSavingPersonalRemarks(false);
    }
  };

  const handleAddRemark = async (e) => {
    e.preventDefault();
    if (!remarkText.trim()) return;
    setSavingRemark(true);
    try {
      await addLeadRemark(leadId, { note: remarkText.trim() });
      setRemarkText('');
      toast.success('Remark added');
      onRemarkSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add remark');
    } finally {
      setSavingRemark(false);
    }
  };

  if (loading || leadLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
          Last 5 activities
        </p>
        {!activities.length ? (
          <p className="text-sm text-gray-400 py-2">No activity recorded yet for this lead.</p>
        ) : (
          <div className="space-y-2">
            {activities.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                    {item.type}
                  </span>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">
                    {formatActivityDateTime(item.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap break-words">
                  {item.description}
                </p>
                <p className="text-xs text-gray-500 mt-1">{item.performedBy}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sm:w-72 shrink-0 flex flex-col gap-3">
        <div className="border border-gray-200 rounded-lg p-3 bg-white" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-600">Personal Remarks</span>
            {canEditPersonalRemarks && !editingPersonalRemarks ? (
              <button
                type="button"
                onClick={() => setEditingPersonalRemarks(true)}
                className="text-gray-500 hover:text-indigo-600 p-0.5"
                title="Edit personal remarks"
              >
                <Pencil className="w-3 h-3" />
              </button>
            ) : null}
          </div>
          {loadError ? (
            <div className="text-xs text-red-600">
              {loadError}
              <button
                type="button"
                onClick={loadLead}
                className="ml-2 text-indigo-600 hover:underline"
              >
                Retry
              </button>
            </div>
          ) : canEditPersonalRemarks && editingPersonalRemarks ? (
            <div className="space-y-2">
              <textarea
                value={personalRemarks}
                onChange={(e) => setPersonalRemarks(e.target.value)}
                placeholder="Optional private sales notes (not timeline remarks)..."
                rows={3}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={handleSavePersonalRemarks}
                  disabled={savingPersonalRemarks}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Save className="w-3 h-3" />
                  {savingPersonalRemarks ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPersonalRemarks(false);
                    setPersonalRemarks(lead?.personalRemarks ?? lead?.personal_remarks ?? '');
                  }}
                  className="px-2 py-1 text-xs font-medium border border-gray-200 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-600 whitespace-pre-wrap min-h-[2rem]">
              {lead?.personalRemarks || lead?.personal_remarks || '-'}
            </div>
          )}
        </div>

        {canAddRemark ? (
          <form
            onSubmit={handleAddRemark}
            className="border border-gray-200 rounded-lg p-3 bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <label className="block text-xs font-medium text-gray-600 mb-1">Add Remark</label>
            <textarea
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              placeholder="Customer query or note..."
              rows={2}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={savingRemark || !remarkText.trim()}
              className="mt-2 w-full py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <MessageSquarePlus className="w-3 h-3" />
              {savingRemark ? 'Saving...' : '+ Save'}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
