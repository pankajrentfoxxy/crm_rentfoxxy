import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquarePlus, Save, Pencil } from 'lucide-react';

export default function ExpandedRowContent({ leadId, api, onRemarkSaved, user }) {
    const [lead, setLead] = useState(null);
    const [loading, setLoading] = useState(true);
    const [remarkText, setRemarkText] = useState('');
    const [savingRemark, setSavingRemark] = useState(false);
    const [personalRemarks, setPersonalRemarks] = useState('');
    const [savingPersonalRemarks, setSavingPersonalRemarks] = useState(false);
    const [editingPersonalRemarks, setEditingPersonalRemarks] = useState(false);
    const currentUserId = user?.user_id ?? user?.userId;
    const canEditPersonalRemarks = ['admin', 'manager', 'sales'].includes(user?.role)
        && (user?.role !== 'sales' || String(lead?.assignedUserId) === String(currentUserId));

    const loadLead = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/leads/${leadId}`);
            setLead(data.lead);
            setPersonalRemarks(data.lead?.personalRemarks ?? data.lead?.personal_remarks ?? '');
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [api, leadId]);

    useEffect(() => {
        loadLead();
    }, [loadLead]);

    const handleSavePersonalRemarks = async () => {
        setSavingPersonalRemarks(true);
        try {
            await api.put(`/leads/${leadId}/basic`, { personal_remarks: personalRemarks });
            setLead((prev) => ({ ...prev, personalRemarks }));
            setEditingPersonalRemarks(false);
            onRemarkSaved?.();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to save personal remarks');
        } finally {
            setSavingPersonalRemarks(false);
        }
    };

    const handleAddRemark = async (e) => {
        e.preventDefault();
        if (!remarkText.trim()) return;
        setSavingRemark(true);
        try {
            const { data } = await api.post(`/leads/${leadId}/remarks`, { note: remarkText.trim() });
            setLead((prev) => ({ ...prev, remarks: [data.remark, ...(prev.remarks || [])] }));
            setRemarkText('');
            onRemarkSaved?.();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to add remark');
        } finally {
            setSavingRemark(false);
        }
    };

    const mergedItems = useMemo(() => {
        if (!lead) return [];
        const activities = (lead.activities || []).map((a) => ({
            type: 'activity',
            id: a.activityId,
            text: a.action === 'status_updated'
                ? `Status: ${a.statusFrom || '?'} → ${a.statusTo || '-'}${a.stageTo ? ` · Stage: ${a.stageTo}` : ''}`
                : a.action.replace(/_/g, ' '),
            detail: a.notes,
            user: a.user?.name,
            createdAt: a.createdAt
        }));
        const remarks = (lead.remarks || []).map((r) => ({
            type: 'remark',
            id: r.remarkId,
            text: r.note,
            detail: null,
            user: r.userName,
            createdAt: r.createdAt
        }));
        return [...activities, ...remarks]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5);
    }, [lead]);

    return (
        <div className="py-2 px-2">
            {loading ? (
                <div className="text-center py-6 text-slate-500 text-sm">Loading...</div>
            ) : (
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-600 mb-2">Last 5 activities</div>
                        <div className="space-y-2">
                            {mergedItems.length === 0 ? (
                                <div className="text-xs text-slate-500 py-2">No activity yet.</div>
                            ) : (
                                mergedItems.map((item) => (
                                    <div key={`${item.type}-${item.id}`} className="border border-slate-100 rounded p-2 text-xs bg-white">
                                        <div className="font-medium text-slate-700">{item.text}</div>
                                        {item.detail && <div className="text-slate-500 mt-0.5">{item.detail}</div>}
                                        <div className="text-slate-400 mt-1">{item.user || '-'} · {new Date(item.createdAt).toLocaleString()}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                    <div className="sm:w-72 shrink-0 flex flex-col gap-3">
                        <div className="border border-slate-200 rounded-lg p-3 bg-white">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-slate-600">Personal Remarks</span>
                                {canEditPersonalRemarks && !editingPersonalRemarks && (
                                    <button
                                        onClick={() => setEditingPersonalRemarks(true)}
                                        className="text-slate-500 hover:text-indigo-600 p-0.5"
                                        title="Edit"
                                    >
                                        <Pencil className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                            {canEditPersonalRemarks && editingPersonalRemarks ? (
                                <div className="space-y-2">
                                    <textarea
                                        value={personalRemarks}
                                        onChange={(e) => setPersonalRemarks(e.target.value)}
                                        placeholder="Sales notes about this lead..."
                                        rows={3}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                    <div className="flex gap-1">
                                        <button
                                            onClick={handleSavePersonalRemarks}
                                            disabled={savingPersonalRemarks}
                                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                                        >
                                            <Save className="w-3 h-3" /> {savingPersonalRemarks ? 'Saving...' : 'Save'}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingPersonalRemarks(false);
                                                setPersonalRemarks(lead?.personalRemarks ?? lead?.personal_remarks ?? '');
                                            }}
                                            className="px-2 py-1 text-xs font-medium border border-slate-200 rounded hover:bg-slate-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-xs text-slate-600 whitespace-pre-wrap min-h-[2rem]">
                                    {lead?.personalRemarks || lead?.personal_remarks || '-'}
                                </div>
                            )}
                        </div>
                        <form onSubmit={handleAddRemark} className="border border-slate-200 rounded-lg p-3 bg-white">
                            <label className="block text-xs font-medium text-slate-600 mb-1">Add Remark</label>
                            <textarea
                                value={remarkText}
                                onChange={(e) => setRemarkText(e.target.value)}
                                placeholder="Customer query or note..."
                                rows={2}
                                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                            <button
                                type="submit"
                                disabled={savingRemark || !remarkText.trim()}
                                className="mt-2 w-full py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1"
                            >
                                <MessageSquarePlus className="w-3 h-3" /> {savingRemark ? 'Saving...' : 'Save'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
