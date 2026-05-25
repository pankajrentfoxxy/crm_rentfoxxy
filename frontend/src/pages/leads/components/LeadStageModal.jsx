export default function LeadStageModal({ modal, onClose, onStageChange, onSave }) {
    if (!modal) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 border border-slate-200">
                <h3 className="text-sm font-bold text-slate-800">Select lead stage</h3>
                <p className="text-xs text-slate-500 mt-1">
                    Status: <strong>{modal.newStatus}</strong> — choose the stage (reason) for this update.
                </p>
                <label className="block mt-3 text-xs font-medium text-slate-600">Lead stage</label>
                <select
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={modal.selectedStage}
                    onChange={(e) => onStageChange(e.target.value)}
                >
                    {modal.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
                <div className="flex gap-2 justify-end mt-4">
                    <button
                        type="button"
                        className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                        onClick={async () => {
                            try {
                                await onSave();
                            } catch (err) {
                                alert(err.response?.data?.message || 'Failed to update');
                            }
                        }}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}
