import { isValidIndianGstin } from '../utils';

export default function GstModal({ modal, onClose, onInputChange, onConfirm, onValidationError }) {
    if (!modal) return null;

    return (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 border border-slate-200">
                <h3 className="text-sm font-bold text-slate-800">GSTIN required</h3>
                <p className="text-xs text-slate-500 mt-1">
                    Status <strong>{modal.newStatus}</strong> requires a valid 15-character GSTIN before the lead is
                    linked to Customers.
                </p>
                <label className="block mt-3 text-xs font-medium text-slate-600">GSTIN</label>
                <input
                    type="text"
                    autoComplete="off"
                    maxLength={15}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono uppercase tracking-wide"
                    placeholder="e.g. 22AAAAA0000A1Z5"
                    value={modal.input}
                    onChange={(e) => onInputChange(e.target.value.toUpperCase())}
                />
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
                            if (!isValidIndianGstin(modal.input)) {
                                onValidationError('Enter a valid 15-character GSTIN (format: 22AAAAA0000A1Z5).');
                                return;
                            }
                            try {
                                await onConfirm();
                            } catch (err) {
                                alert(err.response?.data?.message || 'Failed to update status');
                            }
                        }}
                    >
                        Save &amp; continue
                    </button>
                </div>
            </div>
        </div>
    );
}
