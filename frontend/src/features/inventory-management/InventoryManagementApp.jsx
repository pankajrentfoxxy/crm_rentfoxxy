import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
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
import CustomerAssetsPage from './pages/CustomerAssetsPage';

/**
 * Nested routes only — navigation lives in Layout sidebar (accordion).
 */
export default function InventoryManagementApp() {
  return (
    <div className="min-w-0">
      <Routes>
        <Route
          index
          element={
            <div className="rounded-xl border bg-white shadow-sm p-8 space-y-3">
              <h1 className="text-2xl font-bold text-slate-900">Inventory Management</h1>
              <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
                Mirrors the Laravel admin Inventory Management tree: ready-to-rent lists by PO type, spare parts,
                serial status, universal search, and NPA assets.
              </p>
              <ul className="text-xs text-slate-500 grid sm:grid-cols-2 gap-2 mt-6">
                <li className="border rounded-lg p-4 bg-sky-50/40 border-sky-100">
                  Lists at <code className="text-[11px]">admin/inventory/inventory-list/{'{segment}'}</code>
                </li>
                <li className="border rounded-lg p-4 bg-slate-50">
                  CRM refurb flow remains at <code className="text-[11px]">/inventory</code>
                </li>
              </ul>
            </div>
          }
        />

        <Route path="customer-assets" element={<CustomerAssetsPage />} />
        <Route path="ready-to-rent-or-sell" element={<ReadyToRentOrSellPage />} />
        <Route path="qc-process" element={<QcProcessPage />} />
        <Route path="rent-to-own" element={<RentToOwnPage />} />
        <Route path="rental-purchase" element={<RentalPurchasePage />} />
        <Route path="direct-purchase" element={<DirectPurchasePage />} />
        <Route path="out-for-repare" element={<OutForReparePage />} />
        <Route path="spare-parts" element={<SparePartsInventoryPage />} />
        <Route path="parts" element={<PartsPage />} />
        <Route path="serial-number-status" element={<SerialNumberStatusPage />} />
        <Route path="universal-search" element={<UniversalSearchPage />} />
        <Route path="npa-assets" element={<NpaAssetsPage />} />

        <Route path="*" element={<Navigate to="/inventory-management" replace />} />
      </Routes>
    </div>
  );
}
