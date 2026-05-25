import { useState } from 'react';
import { toDateTimeLocalValue } from '../utils';

export default function FollowUpCell({ lead, api, followUpLeadId, setFollowUpLeadId, onUpdated, user }) {
    const [followUpValue, setFollowUpValue] = useState(toDateTimeLocalValue(lead.followUpDate));
    const [saving, setSaving] = useState(false);
    const currentUserId = user?.user_id ?? user?.userId;
    const canUpdate = ['admin', 'manager', 'sales'].includes(user?.role)
        && (user?.role !== 'sales' || String(lead.assignedUserId) === String(currentUserId));
    const isOpen = followUpLeadId === lead.leadId;

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put(`/leads/${lead.leadId}/follow-up`, {
                follow_up_date: followUpValue ? new Date(followUpValue).toISOString() : null
            });
            setFollowUpLeadId(null);
            onUpdated?.();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to update follow-up');
        } finally {
            setSaving(false);
        }
    };

    const handleClear = async () => {
        setSaving(true);
        try {
            await api.put(`/leads/${lead.leadId}/follow-up`, { follow_up_date: null });
            setFollowUpValue('');
            setFollowUpLeadId(null);
            onUpdated?.();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to clear follow-up');
        } finally {
            setSaving(false);
        }
    };

    const formatCompact = (d) => d
        ? new Date(d).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '-';

    if (!canUpdate) {
        return (
            <span className="text-slate-600 text-[10px] inline-block whitespace-nowrap">
                {formatCompact(lead.followUpDate)}
            </span>
        );
    }

    return (
        <div className="relative flex justify-center items-center">
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setFollowUpLeadId(isOpen ? null : lead.leadId);
                    setFollowUpValue(toDateTimeLocalValue(lead.followUpDate));
                }}
                className="text-slate-600 hover:text-slate-800 text-[10px] hover:underline whitespace-nowrap"
            >
                {lead.followUpDate ? formatCompact(lead.followUpDate) : 'Set'}
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setFollowUpLeadId(null); }} />
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-[200px]">
                        <input
                            type="datetime-local"
                            value={followUpValue}
                            onChange={(e) => setFollowUpValue(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 mb-2"
                        />
                        <div className="flex gap-1">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving}
                                className="flex-1 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {saving ? '...' : 'Save'}
                            </button>
                            <button
                                type="button"
                                onClick={handleClear}
                                disabled={saving}
                                className="py-1.5 px-2 text-xs font-medium text-slate-600 border border-slate-200 rounded hover:bg-slate-50"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
