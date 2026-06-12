import React from 'react';
import InventoryPageShell from '../components/InventoryPageShell';

export default function NpaAssetsPage() {
  return (
    <InventoryPageShell
      title="NPA Assets"
      description="Non-performing assets — requires delivery challan / ERP sync for full NPA workflow."
      erpSegment="npa-assets"
    />
  );
}
