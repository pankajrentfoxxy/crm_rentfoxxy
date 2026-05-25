import { RefreshCw, Download, Upload, Filter, Plus, UserPlus } from 'lucide-react';
import { Btn } from '../../../components/ui';

export default function LeadTableToolbar({
    activeFilterCount,
    onOpenFilters,
    onOpenManualEntry,
    onOpenAssign,
    selectedCount,
    canManualCreate,
    canAssignLeads,
    onRefresh,
    loading,
    onExport,
    exportingCsv,
    onDownloadSample,
    onUpload,
    uploading,
    canManage
}) {
    return (
        <>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
                {canManualCreate && (
                    <Btn variant="outline" icon={Plus} small onClick={onOpenManualEntry}>
                        Add Lead
                    </Btn>
                )}
                {canAssignLeads && (
                    <Btn variant="outline" icon={UserPlus} small onClick={onOpenAssign}>
                        Assign{selectedCount > 0 ? ` (${selectedCount})` : ''}
                    </Btn>
                )}
                <Btn variant="outline" icon={Filter} small onClick={onOpenFilters}>
                    Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </Btn>
                <Btn variant="outline" icon={RefreshCw} small onClick={onRefresh}>
                    {loading ? '…' : 'Refresh'}
                </Btn>
                <Btn variant="outline" icon={Download} small onClick={onExport} disabled={exportingCsv}>
                    {exportingCsv ? '…' : 'Export'}
                </Btn>
                <Btn variant="outline" icon={Upload} small onClick={onDownloadSample}>Sample</Btn>
                {canManage && (
                    <label style={{ cursor: 'pointer', display: 'inline-flex' }}>
                        <Btn variant="primary" icon={Upload} small>{uploading ? '…' : 'Upload CSV'}</Btn>
                        <input type="file" accept=".csv" hidden onChange={onUpload} />
                    </label>
                )}
            </div>
        </>
    );
}
