import React, { useState } from 'react';
import ReturnDcDetailModal from '../../../features/sales-pipeline/components/ReturnDcDetailModal';
import usePermission from '../../../hooks/usePermission';

/**
 * Renders a Return DC number. If the user can view Return DC, it opens the
 * same RDC detail modal used on the Return DC register.
 */
export default function ReturnDcNumberLink({
  rdcNumber,
  className = '',
  children,
  onUpdated,
}) {
  const { canView } = usePermission();
  const [open, setOpen] = useState(false);
  if (!rdcNumber) return null;

  const label = children || rdcNumber;
  if (!canView('return_dc')) {
    return <span className={className}>{label}</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`bg-transparent border-0 p-0 m-0 cursor-pointer underline underline-offset-2 hover:opacity-80 ${className}`.trim()}
        title={`Open Return DC ${rdcNumber}`}
      >
        {label}
      </button>
      {open && (
        <ReturnDcDetailModal
          rdcNumber={rdcNumber}
          onClose={() => setOpen(false)}
          onUpdated={onUpdated}
        />
      )}
    </>
  );
}
