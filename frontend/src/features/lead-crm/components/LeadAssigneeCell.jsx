import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { assignLeads } from '../leadCrmApi';

function roleSuffix(role) {
  if (role === 'sales') return ' (Sales)';
  return '';
}

export default function LeadAssigneeCell({
  lead,
  assignableUsers = [],
  canChange = false,
  onUpdated,
}) {
  const [busy, setBusy] = useState(false);
  const currentId = lead.assignedUserId ?? lead.assigned_user_id ?? '';
  const currentName = lead.assignedUser?.name || 'Unassigned';

  if (!canChange || !assignableUsers.length) {
    return <span className="text-xs text-gray-700">{currentName === 'Unassigned' ? '—' : currentName}</span>;
  }

  const handleChange = async (e) => {
    const uid = e.target.value;
    if (!uid || String(uid) === String(currentId || '')) return;
    setBusy(true);
    try {
      await assignLeads({ lead_ids: [lead.leadId], sales_user_id: parseInt(uid, 10) });
      toast.success('Assignee updated');
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change assignee');
      e.target.value = currentId ? String(currentId) : '';
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      className="text-xs border border-gray-200 rounded-lg px-2 py-1 max-w-[160px] bg-white disabled:opacity-50"
      value={currentId ? String(currentId) : ''}
      disabled={busy}
      onChange={handleChange}
      title="Change assignee"
    >
      <option value="">Unassigned</option>
      {assignableUsers.map((u) => {
        const id = u.user_id || u.userId;
        return (
          <option key={id} value={id}>
            {u.name}{roleSuffix(u.role)}
          </option>
        );
      })}
    </select>
  );
}
