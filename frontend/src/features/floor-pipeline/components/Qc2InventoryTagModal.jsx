import React, { useMemo } from 'react';

const TAG_OPTIONS = [
  { value: 'rental', label: 'Rental' },
  { value: 'sale', label: 'Sale' },
  { value: 'both', label: 'Both (Rental + Sale)' },
];

export default function Qc2InventoryTagModal({
  open,
  onClose,
  onConfirm,
  saving = false,
  purchaseOrderType,
  title = 'Submit QC2 — Inventory Tag',
}) {
  const [tag, setTag] = React.useState('rental');
  const rentalPurchaseLocked = purchaseOrderType === 'rental_purchase';

  React.useEffect(() => {
    if (open) {
      setTag(rentalPurchaseLocked ? 'rental' : 'rental');
    }
  }, [open, rentalPurchaseLocked]);

  const effectiveTag = rentalPurchaseLocked ? 'rental' : tag;

  const tagLabel = useMemo(() => {
    const hit = TAG_OPTIONS.find((o) => o.value === effectiveTag);
    return hit?.label || effectiveTag;
  }, [effectiveTag]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl p-5 space-y-4">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600">
          How should this laptop be listed after inventory receive?
        </p>

        {rentalPurchaseLocked ? (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
            PO type is <strong>Rental Purchase</strong> — tagged as <strong>Rental</strong> automatically.
          </div>
        ) : (
          <div className="space-y-2">
            {TAG_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                  tag === opt.value ? 'border-teal-500 bg-teal-50' : 'border-slate-200'
                }`}
              >
                <input
                  type="radio"
                  name="inventory_tag"
                  value={opt.value}
                  checked={tag === opt.value}
                  onChange={() => setTag(opt.value)}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm border rounded-lg">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onConfirm(effectiveTag)}
            className="px-3 py-2 text-sm rounded-lg bg-teal-600 text-white disabled:opacity-50"
          >
            {saving ? 'Submitting…' : `Submit as ${tagLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
