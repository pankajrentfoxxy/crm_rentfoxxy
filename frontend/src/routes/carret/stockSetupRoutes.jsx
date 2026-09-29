import React from 'react';
import ProtectedRoute from '../../router/ProtectedRoute';

/**
 * Carret — Stock setup (builder 5): Part repairs, Master data, Asset
 * configuration, With customers (deployed fleet). The Parts catalogue stays at
 * /carret/produce/parts (already in carretRoutes.jsx, parts_inventory view) —
 * that page is now the merged catalogue.
 *
 * Each guard is the section(s) the page's API enforces:
 *   part repairs  — routes/partVendorRepair.js viewAny (4 sections); writes
 *                   are part_vendor_repair edit/create or the warehouse roles.
 *   master data   — one section per report (routes/inventoryManagement.js);
 *                   the page shows only the tabs the user has.
 *   asset config  — routes/assetConfiguration.js asset_configuration.
 *   with customers — GET /inventory-management/customer-assets, customer_inventory.
 *
 * `stockSetupRouteDefs` is the plain list ({ path, section|sections, action,
 * element }); the default export is the same list already wrapped the way
 * carretRoutes.jsx wraps (ProtectedRoute + Suspense), ready to spread.
 */
const PartRepairsPage = React.lazy(() => import('../../features/carret/stock/setup/PartRepairsPage'));
const PartRepairRecordPage = React.lazy(() => import('../../features/carret/stock/setup/PartRepairRecordPage'));
const MasterDataPage = React.lazy(() => import('../../features/carret/stock/setup/MasterDataPage'));
const AssetConfigPage = React.lazy(() => import('../../features/carret/stock/setup/AssetConfigPage'));
const DeployedFleetPage = React.lazy(() => import('../../features/carret/stock/setup/DeployedFleetPage'));

const PART_REPAIR_SECTIONS = ['part_vendor_repair', 'parts_procurement', 'parts_inventory', 'inventory_management'];
const MASTER_DATA_SECTIONS = ['inventory_master_data', 'inventory_vendor_master_data', 'inventory_return_master_data'];

export const stockSetupRouteDefs = [
  { path: '/carret/stock/part-repairs', sections: PART_REPAIR_SECTIONS, action: 'view', element: <PartRepairsPage /> },
  { path: '/carret/stock/part-repairs/:dcNumber', sections: PART_REPAIR_SECTIONS, action: 'view', element: <PartRepairRecordPage /> },
  { path: '/carret/stock/master-data', sections: MASTER_DATA_SECTIONS, action: 'view', element: <MasterDataPage /> },
  { path: '/carret/stock/asset-configuration', section: 'asset_configuration', action: 'view', element: <AssetConfigPage /> },
  { path: '/carret/stock/with-customers', section: 'customer_inventory', action: 'view', element: <DeployedFleetPage /> },
];

const wrap = ({ path, section, sections, action, element }) => ({
  path,
  element: (
    <ProtectedRoute {...(sections ? { sections } : { section })} action={action}>
      <React.Suspense fallback={null}>{element}</React.Suspense>
    </ProtectedRoute>
  ),
});

export const stockSetupRoutes = stockSetupRouteDefs.map(wrap);
export default stockSetupRoutes;
