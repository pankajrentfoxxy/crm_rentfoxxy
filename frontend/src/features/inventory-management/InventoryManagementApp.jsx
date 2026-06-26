import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import usePermission from '../../hooks/usePermission';
import ReadyToRentOrSellPage from './pages/ReadyToRentOrSellPage';
import QcProcessPage from './pages/QcProcessPage';
import RentToOwnPage from './pages/RentToOwnPage';
import RentalPurchasePage from './pages/RentalPurchasePage';
import DirectPurchasePage from './pages/DirectPurchasePage';
import OutForReparePage from './pages/OutForReparePage';
import SparePartsInventoryPage from './pages/SparePartsInventoryPage';
import SerialNumberStatusPage from './pages/SerialNumberStatusPage';
import UniversalSearchPage from './pages/UniversalSearchPage';
import NpaAssetsPage from './pages/NpaAssetsPage';
import PartsPage from './pages/PartsPage';
import PartsApprovalPage from './pages/PartsApprovalPage';
import CustomerAssetsPage from './pages/CustomerAssetsPage';
import PartsMovementHistoryPage from './pages/PartsMovementHistoryPage';
import TtsplHistorySearchPage from './pages/TtsplHistorySearchPage';

const g = (section, node) => (
  <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>
);

function InventoryIndexRedirect() {
  const { canView } = usePermission();
  if (canView('inventory_management')) return <Navigate to="universal-search" replace />;
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
        <Route path="qc-process" element={g('inventory_management', <QcProcessPage />)} />
        <Route path="rent-to-own" element={g('inventory_management', <RentToOwnPage />)} />
        <Route path="rental-purchase" element={g('inventory_management', <RentalPurchasePage />)} />
        <Route path="direct-purchase" element={g('inventory_management', <DirectPurchasePage />)} />
        <Route path="out-for-repare" element={g('inventory_management', <OutForReparePage />)} />
        <Route path="spare-parts" element={g('inventory_management', <SparePartsInventoryPage />)} />
        <Route path="parts" element={g('parts_inventory', <PartsPage />)} />
        <Route path="parts-approval" element={g('parts_inventory', <PartsApprovalPage />)} />
        <Route path="parts-history" element={g('parts_inventory', <PartsMovementHistoryPage />)} />
        <Route path="serial-number-status" element={g('inventory_management', <SerialNumberStatusPage />)} />
        <Route path="universal-search" element={g('inventory_management', <UniversalSearchPage />)} />
        <Route path="npa-assets" element={g('inventory_management', <NpaAssetsPage />)} />
        <Route path="ttspl-history" element={g('ttspl_history', <TtsplHistorySearchPage />)} />

        <Route path="*" element={<InventoryIndexRedirect />} />
      </Routes>
    </div>
  );
}
