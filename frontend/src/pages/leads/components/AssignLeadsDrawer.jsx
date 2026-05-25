import { Drawer, Btn } from '../../../components/ui';

export default function AssignLeadsDrawer({
    open,
    onClose,
    salesUsers,
    assignTo,
    onAssignToChange,
    selectedCount,
    onAssign,
    assignUsers,
    onToggleAssignUser,
    onAssignUnassigned,
    assigningUnassigned
}) {
    return (
        <Drawer open={open} onClose={onClose} title="Assign Leads" width={400}>
            <div className="space-y-5">
                <div>
                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Assign selected</div>
                    <p className="text-xs text-slate-500 mb-3">
                        {selectedCount > 0
                            ? `${selectedCount} lead(s) selected from the table.`
                            : 'Select leads using the checkboxes in the table first.'}
                    </p>
                    <div className="flex flex-col gap-2">
                        <select
                            value={assignTo}
                            onChange={(e) => onAssignToChange(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full"
                        >
                            <option value="">Select sales user</option>
                            {salesUsers.map((user) => (
                                <option key={user.user_id} value={user.user_id}>{user.name}</option>
                            ))}
                        </select>
                        <Btn
                            small
                            onClick={onAssign}
                            disabled={!assignTo || selectedCount === 0}
                        >
                            Assign selected
                        </Btn>
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-5 space-y-3">
                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Distribute unassigned equally</div>
                    <p className="text-xs text-slate-500">
                        Select who receives unassigned leads. Future leads (manual, upload, email) will also be auto-assigned to the selected users until you change this.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {salesUsers.map((salesUser) => (
                            <label key={salesUser.user_id} className="flex items-center gap-2 text-sm text-slate-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={assignUsers.includes(salesUser.user_id)}
                                    onChange={() => onToggleAssignUser(salesUser.user_id)}
                                    className="rounded"
                                />
                                <span>{salesUser.name}</span>
                            </label>
                        ))}
                    </div>
                    <Btn
                        small
                        onClick={onAssignUnassigned}
                        disabled={assignUsers.length === 0 || assigningUnassigned}
                    >
                        {assigningUnassigned ? 'Assigning…' : 'Auto Assign Unassigned'}
                    </Btn>
                </div>

                <div style={{ paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                    <Btn variant="outline" small onClick={onClose} style={{ width: '100%' }}>Done</Btn>
                </div>
            </div>
        </Drawer>
    );
}
