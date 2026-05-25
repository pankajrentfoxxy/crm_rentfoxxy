import { Drawer, Btn } from '../../../components/ui';
import { SOURCE_OPTIONS } from '../constants';

export default function ManualLeadEntryDrawer({
    open,
    onClose,
    manualLead,
    onFieldChange,
    onCreate,
    creating
}) {
    return (
        <Drawer open={open} onClose={onClose} title="Manual Lead Entry" width={400}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Date</label>
                    <input
                        type="date"
                        value={manualLead.date}
                        readOnly
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Name</label>
                    <input
                        value={manualLead.name}
                        onChange={(e) => onFieldChange('name', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        placeholder="Lead name (optional)"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Company</label>
                    <input
                        value={manualLead.company_name}
                        onChange={(e) => onFieldChange('company_name', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        placeholder="Company name"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Email</label>
                    <input
                        type="email"
                        value={manualLead.email}
                        onChange={(e) => onFieldChange('email', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        placeholder="Email"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Phone *</label>
                    <input
                        value={manualLead.phone}
                        onChange={(e) => onFieldChange('phone', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        placeholder="Phone (required)"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">City</label>
                    <input
                        value={manualLead.city}
                        onChange={(e) => onFieldChange('city', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        placeholder="City"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Source</label>
                    <select
                        value={manualLead.source}
                        onChange={(e) => onFieldChange('source', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    >
                        {SOURCE_OPTIONS.map((source) => (
                            <option key={source} value={source}>{source}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                    <Btn variant="outline" small onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
                    <Btn small onClick={onCreate} disabled={creating} style={{ flex: 1 }}>
                        {creating ? 'Saving…' : 'Create Lead'}
                    </Btn>
                </div>
            </div>
        </Drawer>
    );
}
