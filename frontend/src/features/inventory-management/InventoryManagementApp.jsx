import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import usePermission from '../../hooks/usePermission';
import ReadyToRentOrSellPage from './pages/ReadyToRentOrSellPage';
import QcProcessPage from './pages/QcProcessPage';
import QcPendingPage from './pages/QcPendingPage';
import DeadLaptopPage from './pages/DeadLaptopPage';
import MissingLaptopPage from './pages/MissingLaptopPage';
import AssetMovementPage from './pages/AssetMovementPage';
import RentToOwnPage from './pages/RentToOwnPage';
import RentalPurchasePage from './pages/RentalPurchasePage';
import DirectPurchasePage from './pages/DirectPurchasePage';
import OutForRepairInventoryPage from './pages/OutForRepairInventoryPage';
import OutForReparePage from './pages/OutForReparePage';
import SparePartsInventoryPage from './pages/SparePartsInventoryPage';
import SerialNumberStatusPage from './pages/SerialNumberStatusPage';
import UniversalSearchPage from './pages/UniversalSearchPage';
import NpaAssetsPage from './pages/NpaAssetsPage';
import PartsPage from './pages/PartsPage';
import PartsApprovalPage from './pages/PartsApprovalPage';
import PartsDashboardPage from './pages/PartsDashboardPage';
import CustomerAssetsPage from './pages/CustomerAssetsPage';
import PartsMovementHistoryPage from './pages/PartsMovementHistoryPage';
import MasterDataDashboardPage from './pages/MasterDataDashboardPage';
import TtsplHistorySearchPage from './pages/TtsplHistorySearchPage';

const g = (section, node) => (
  <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>
);

function InventoryIndexRedirect() {
  const { canView } = usePermission();
  if (canView('inventory_management')) return <Navigate to="qc-process" replace />;
  if (canView('inventory_master_data')) return <Navigate to="master-data" replace />;
  if (canView('inventory_asset_movement')) return <Navigate to="asset-movement" replace />;
  if (canView('parts_inventory')) return <Navigate to="parts" replace />;
  if (canView('customer_inventory')) return <Navigate to="customer-assets" replace />;
  if (canView('ttspl_history')) return <Navigate to="ttspl-history" replace />;
  return <Navigate to="/dashboard" replace />;
}

/**
 * Nested routes only — navigation lives in Layout sidebar (accordion).
 */
export default function InventoryManagementApp() {
  return (
    <div className="min-w-0">
      <Routes>
        <Route index element={<InventoryIndexRedirect />} />

        <Route path="customer-assets" element={g('customer_inventory', <CustomerAssetsPage />)} />
        <Route path="ready-to-rent-or-sell" element={g('inventory_management', <ReadyToRentOrSellPage />)} />
        <Route path="qc-pending" element={g('inventory_management', <QcPendingPage />)} />
        <Route path="qc-process" element={g('inventory_management', <QcProcessPage />)} />
        <Route path="dead-laptops" element={g('inventory_management', <DeadLaptopPage />)} />
        <Route path="missing-laptops" element={g('inventory_management', <MissingLaptopPage />)} />
        <Route path="asset-movement" element={g('inventory_asset_movement', <AssetMovementPage />)} />
        <Route path="out-for-repair" element={g('inventory_management', <OutForRepairInventoryPage />)} />
        <Route path="rent-to-own" element={g('inventory_management', <RentToOwnPage />)} />
        <Route path="rental-purchase" element={g('inventory_management', <RentalPurchasePage />)} />
        <Route path="direct-purchase" element={g('inventory_management', <DirectPurchasePage />)} />
        <Route path="out-for-repare" element={g('inventory_management', <OutForReparePage />)} />
        <Route path="spare-parts" element={g('inventory_management', <SparePartsInventoryPage />)} />
        <Route path="parts-dashboard" element={g('parts_inventory', <PartsDashboardPage />)} />
        <Route path="parts" element={g('parts_inventory', <PartsPage />)} />
        <Route path="parts-approval" element={g('parts_inventory', <PartsApprovalPage />)} />
        <Route path="parts-history" element={g('parts_inventory', <PartsMovementHistoryPage />)} />
        <Route path="serial-number-status" element={g('inventory_management', <SerialNumberStatusPage />)} />
        <Route path="universal-search" element={g('inventory_management', <UniversalSearchPage />)} />
        <Route path="npa-assets" element={g('inventory_management', <NpaAssetsPage />)} />
        <Route path="master-data" element={g('inventory_master_data', <MasterDataDashboardPage />)} />
        <Route path="ttspl-history" element={g('ttspl_history', <TtsplHistorySearchPage />)} />

        <Route path="*" element={<InventoryIndexRedirect />} />
      </Routes>
    </div>
  );
}
