import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { getLead, updateLeadBasic } from '../leadCrmApi';

export default function PersonalRemarksPanel({
  leadId,
  value,
  assignedUserId,
  onSaved,
  compact = false,
  className = '',
}) {
  const { user, hasPermission, isAssignedDataOnly } = useAuth();
  const [text, setText] = useState(value ?? '');
  const [resolvedAssignedId, setResolvedAssignedId] = useState(assignedUserId);
  const [loading, setLoading] = useState(!value && Boolean(leadId));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftBeforeEdit, setDraftBeforeEdit] = useState('');

  const currentUserId = user?.user_id ?? user?.userId;
  const role = String(user?.role || '').toLowerCase();
  const canEditByPermission = typeof hasPermission === 'function' && hasPermission('leads', 'edit');
  const canEditByRole = ['super_admin', 'admin', 'manager', 'sales'].includes(role);
  // Admins/managers can always edit any lead's remarks regardless of assignment scope.
  const isPrivileged = ['super_admin', 'admin', 'manager'].includes(role);
  const assignedOnly = typeof isAssignedDataOnly === 'function' && isAssignedDataOnly('leads');
  const isAssignee =
    resolvedAssignedId == null || String(resolvedAssignedId) === String(currentUserId);
  const canEdit = (canEditByPermission || canEditByRole) && (isPrivileged || !assignedOnly || isAssignee);

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const { data } = await getLead(leadId);
      const lead = data?.lead || data;
      const remarks = lead?.personalRemarks ?? lead?.personal_remarks ?? '';
      setText(remarks);
      setResolvedAssignedId(lead?.assignedUserId ?? lead?.assigned_user_id ?? assignedUserId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load personal remarks');
    } finally {
      setLoading(false);
    }
  }, [leadId, assignedUserId]);

  useEffect(() => {
    if (value !== undefined) {
      setText(value ?? '');
      setLoading(false);
    } else if (leadId) {
      load();
    }
  }, [value, leadId, load]);

  useEffect(() => {
    if (assignedUserId !== undefined) setResolvedAssignedId(assignedUserId);
  }, [assignedUserId]);

  const handleSave = async () => {
    if (!leadId) return;
    setSaving(true);
    try {
      const { data } = await updateLeadBasic(leadId, { personal_remarks: text });
      const updated = data?.lead;
      const saved = updated?.personalRemarks ?? updated?.personal_remarks ?? text;
      setText(saved || '');
      setEditing(false);
      toast.success('Personal remarks saved');
      onSaved?.(saved);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save personal remarks');
    } finally {
      setSaving(false);
    }
  };

  const pad = compact ? 'p-3' : 'p-4';
  const labelCls = compact ? 'text-xs font-semibold text-gray-600' : 'text-sm font-medium text-gray-700';
  const textCls = compact ? 'text-xs' : 'text-sm';

  return (
    <div className={`rounded-xl border border-amber-100 bg-amber-50/40 ${pad} ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={labelCls}>Personal Remarks</span>
        {canEdit && !editing && !loading ? (
          <button
            type="button"
            onClick={() => {
              setDraftBeforeEdit(text);
              setEditing(true);
            }}
            className="text-gray-500 hover:text-indigo-600 p-0.5"
            title="Edit personal remarks"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>
      <p className={`${textCls} text-gray-500 mb-2`}>
        Private sales notes — visible here while scheduling follow-ups.
      </p>

      {loading ? (
        <div className={`flex items-center gap-2 ${textCls} text-gray-400`}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : canEdit && editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Budget, objections, callback context, decision maker…"
            rows={compact ? 3 : 4}
            className={`w-full ${textCls} border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="w-3 h-3" />
              {saving ? 'Saving…' : 'Save remarks'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText(draftBeforeEdit);
              }}
              className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={`${textCls} text-gray-800 whitespace-pre-wrap min-h-[2.5rem] bg-white/70 rounded-lg border border-amber-100 px-3 py-2`}>
          {text?.trim() ? text : '—'}
        </div>
      )}
    </div>
  );
}
