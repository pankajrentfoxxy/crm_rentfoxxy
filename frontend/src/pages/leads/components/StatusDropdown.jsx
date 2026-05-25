import { ChevronDown, ChevronUp } from 'lucide-react';
import { STATUS_OPTIONS } from '../constants';

export default function StatusDropdown({ lead, statusDropdownLeadId, setStatusDropdownLeadId, onStatusIntent, user }) {
    const currentUserId = user?.user_id ?? user?.userId;
    const canUpdate = ['admin', 'manager', 'sales'].includes(user?.role)
        && (user?.role !== 'sales' || String(lead.assignedUserId) === String(currentUserId));
    const isOpen = statusDropdownLeadId === lead.leadId;

    const handleStatusSelect = (newStatus) => {
        onStatusIntent(lead, newStatus);
    };

    if (!canUpdate) {
        return (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                {lead.status}
            </span>
        );
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setStatusDropdownLeadId(isOpen ? null : lead.leadId); }}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
                <span className="flex items-center gap-0.5">
                    {lead.status} {isOpen ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                </span>
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setStatusDropdownLeadId(null); }} />
                    <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[100px]">
                        {STATUS_OPTIONS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleStatusSelect(s); }}
                                className={`block w-full text-left px-2 py-1 text-[10px] hover:bg-slate-50 ${s === lead.status ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-700'}`}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
