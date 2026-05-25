import { SearchBar, Btn, Drawer, DrawerSection, PRIMARY } from '../../../components/ui';
import { STATUS_OPTIONS, SOURCE_OPTIONS, dateInputStyle } from '../constants';
import FilterCheckbox from './FilterCheckbox';

export default function LeadFilterDrawer({
    open,
    onClose,
    search,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    sourceFilter,
    onSourceFilterChange,
    assigneeSelection,
    onAssigneeSelectionChange,
    fullAssigneeKeys,
    salesUsers,
    canAssignLeads,
    dateFrom,
    onDateFromChange,
    dateTo,
    onDateToChange,
    onReset
}) {
    return (
        <Drawer open={open} onClose={onClose} title="Filters">
            <div style={{ marginBottom: 20 }}>
                <p style={{
                    margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: PRIMARY,
                    textTransform: 'uppercase', letterSpacing: '0.04em'
                }}>
                    Search
                </p>
                <SearchBar
                    placeholder="Name, company, email, phone…"
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </div>

            <DrawerSection title="Status">
                <FilterCheckbox
                    bold
                    checked={statusFilter.length === STATUS_OPTIONS.length}
                    indeterminate={statusFilter.length > 0 && statusFilter.length < STATUS_OPTIONS.length}
                    onChange={(e) => onStatusFilterChange(e.target.checked ? [...STATUS_OPTIONS] : [])}
                    label="All"
                />
                {STATUS_OPTIONS.map((s) => (
                    <FilterCheckbox
                        key={s}
                        checked={statusFilter.includes(s)}
                        onChange={(e) => {
                            if (e.target.checked) onStatusFilterChange([...new Set([...statusFilter, s])]);
                            else onStatusFilterChange(statusFilter.filter((x) => x !== s));
                        }}
                        label={s}
                    />
                ))}
            </DrawerSection>

            <DrawerSection title="Source">
                <FilterCheckbox
                    bold
                    checked={sourceFilter.length === SOURCE_OPTIONS.length}
                    indeterminate={sourceFilter.length > 0 && sourceFilter.length < SOURCE_OPTIONS.length}
                    onChange={(e) => onSourceFilterChange(e.target.checked ? [...SOURCE_OPTIONS] : [])}
                    label="All"
                />
                {SOURCE_OPTIONS.map((s) => (
                    <FilterCheckbox
                        key={s}
                        checked={sourceFilter.includes(s)}
                        onChange={(e) => {
                            if (e.target.checked) onSourceFilterChange([...new Set([...sourceFilter, s])]);
                            else onSourceFilterChange(sourceFilter.filter((x) => x !== s));
                        }}
                        label={s}
                    />
                ))}
            </DrawerSection>

            {canAssignLeads && fullAssigneeKeys.length > 0 && assigneeSelection && (
                <DrawerSection title="Assignee">
                    <FilterCheckbox
                        bold
                        checked={assigneeSelection.length === fullAssigneeKeys.length}
                        indeterminate={assigneeSelection.length > 0 && assigneeSelection.length < fullAssigneeKeys.length}
                        onChange={(e) => onAssigneeSelectionChange(e.target.checked ? [...fullAssigneeKeys] : [])}
                        label="All"
                    />
                    <FilterCheckbox
                        checked={assigneeSelection.includes('unassigned')}
                        onChange={(e) => {
                            if (e.target.checked) onAssigneeSelectionChange([...new Set([...assigneeSelection, 'unassigned'])]);
                            else onAssigneeSelectionChange(assigneeSelection.filter((x) => x !== 'unassigned'));
                        }}
                        label="Unassigned"
                    />
                    {salesUsers.map((u) => (
                        <FilterCheckbox
                            key={u.user_id}
                            checked={assigneeSelection.includes(String(u.user_id))}
                            onChange={(e) => {
                                const id = String(u.user_id);
                                if (e.target.checked) onAssigneeSelectionChange([...new Set([...assigneeSelection, id])]);
                                else onAssigneeSelectionChange(assigneeSelection.filter((x) => x !== id));
                            }}
                            label={u.name}
                        />
                    ))}
                </DrawerSection>
            )}

            <div style={{ marginBottom: 20 }}>
                <p style={{
                    margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: PRIMARY,
                    textTransform: 'uppercase', letterSpacing: '0.04em'
                }}>
                    Date range
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                        <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>From</label>
                        <input type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} style={dateInputStyle} />
                    </div>
                    <div>
                        <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>To</label>
                        <input type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} style={dateInputStyle} />
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                <Btn variant="outline" small onClick={onReset} style={{ flex: 1 }}>Reset all</Btn>
                <Btn small onClick={onClose} style={{ flex: 1 }}>Done</Btn>
            </div>
        </Drawer>
    );
}
