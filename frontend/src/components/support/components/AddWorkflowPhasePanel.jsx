import React, { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import api from '../../../utils/api';
import { assigneeOptionLabel } from '../utils';

/** Add pickup or replacement phase items linked to a source complaint/replacement item. */
export default function AddWorkflowPhasePanel({ ticketId, customerId, sourceItem, phaseType, onDone, onCancel }) {
    const [assets, setAssets] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [remarks, setRemarks] = useState('');
    const [assignedTo, setAssignedTo] = useState('');
    const [saving, setSaving] = useState(false);

    const serial = sourceItem?.unique_serial_number || sourceItem?.serial_number;
    const inventoryId = sourceItem?.customer_inventory_id;

    useEffect(() => {
        api.get('/support/technicians').then((r) => setTechnicians(r.data.technicians || []));
        if (customerId) {
            api.get(`/support/customers/${customerId}/assets`).then((r) => setAssets(r.data.assets || []));
        }
    }, [customerId]);

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const asset = assets.find((a) => String(a.id) === String(inventoryId));
            await api.post(`/support/tickets/${ticketId}/phases`, {
                items: [
                    {
                        item_type: phaseType,
                        source_item_id: sourceItem.id,
                        customer_inventory_id: inventoryId || asset?.id,
                        serial_number: serial || asset?.serial_number,
                        unique_serial_number: serial || asset?.unique_serial_number,
                        brand: sourceItem.brand || asset?.model_name?.split(' ')[0],
                        model: sourceItem.model || asset?.model_name,
                        ram: sourceItem.ram || asset?.ram,
                        storage: sourceItem.storage || asset?.storage,
                        generation: sourceItem.generation || asset?.generation,
                        remarks,
                        assigned_to: assignedTo ? Number(assignedTo) : null
                    }
                ]
            });
            onDone?.();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to add phase');
        } finally {
            setSaving(false);
        }
    };

    const title = phaseType === 'pickup' ? 'Schedule pickup' : 'Add replacement unit';

    return (
        <div className="support-phase-panel">
            <div className="support-phase-panel-head">
                <h3>{title}</h3>
                <button type="button" className="support-icon-btn" onClick={onCancel} aria-label="Close">
                    <X className="w-5 h-5" />
                </button>
            </div>
            <p className="support-phase-linked text-xs text-slate-500 mb-2">
                {sourceItem.item_type} · <span className="font-mono">{serial}</span>
            </p>
            <form onSubmit={submit} className="space-y-3">
                <label className="support-label">Remarks
                    <textarea className="support-field min-h-[80px]" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Instructions for technician" />
                </label>
                {phaseType !== 'pickup' && (
                <label className="support-label">Assign technician
                    <select className="support-field" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                        <option value="">Unassigned</option>
                        {technicians.map((t) => (
                            <option key={t.user_id} value={t.user_id}>{assigneeOptionLabel(t)}</option>
                        ))}
                    </select>
                </label>
                )}
                <div className="flex gap-2 pt-2">
                    <button type="button" className="support-btn-outline flex-1" onClick={onCancel}>Cancel</button>
                    <button type="submit" disabled={saving} className="support-btn-primary flex-1 inline-flex items-center justify-center gap-2">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add {phaseType}
                    </button>
                </div>
            </form>
        </div>
    );
}
