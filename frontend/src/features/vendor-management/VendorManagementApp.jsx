import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import VendorMgmtMobileNav from './components/VendorMgmtMobileNav';
import VendorsPage from './pages/VendorsPage';
import VendorDetailPage from './pages/VendorDetailPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import ProductReceivedPage from './pages/ProductReceivedPage';
import GeneratedGrnDetailPage from './pages/GeneratedGrnDetailPage';
import SparePartsPoPage from './pages/SparePartsPoPage';
import SparePartsProductReceivedPage from './pages/SparePartsProductReceivedPage';
import SpareGeneratedGrnDetailPage from './pages/SpareGeneratedGrnDetailPage';
import SerialNumberPage from './pages/SerialNumberPage';
import ReplacedProductsPage from './pages/ReplacedProductsPage';
import BillingMonthlyPage from './pages/BillingMonthlyPage';

/**
 * Nested routes only — navigation lives in Layout sidebar (accordion).
 */
export default function VendorManagementApp() {
  return (
    <div className="min-w-0 pb-16 md:pb-0">
      <Routes>
        <Route
          index
          element={
            <div className="rounded-xl border bg-white shadow-sm p-8 space-y-3">
              <h1 className="text-2xl font-bold text-slate-900">Vendor operations center</h1>
              <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
                This module mirrors the Laravel admin Vendor Management tree (purchase orders, GRN-linked serial edits,
                billing cycles, impersonation). Extend the stubs with full line-item grids, cron exports, and GRN ingestion
                as you deprecate the legacy seller admin surface.
              </p>
              <ul className="text-xs text-slate-500 grid sm:grid-cols-2 gap-2 mt-6">
                <li className="border rounded-lg p-4 bg-orange-50/40 border-orange-100">
                  REST roots at <code className="text-[11px]">/api/vendor-management/**</code>
                </li>
                <li className="border rounded-lg p-4 bg-slate-50">
                  GST helper ports Laravel <code className="text-[11px]">getTotalAmountOfPurchaseOrder</code>
                </li>
              </ul>
            </div>
          }
        />

        <Route path="vendors/new" element={<Navigate to="/vendor-management/vendors" replace />} />
        <Route path="vendors/:id/edit" element={<Navigate to="/vendor-management/vendors" replace />} />
        <Route path="vendors/:id" element={<VendorDetailPage />} />
        <Route path="vendors" element={<VendorsPage />} />

        <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="purchase-orders/:poId/grn-detail" element={<GeneratedGrnDetailPage />} />
        <Route path="purchase-orders/:poId/receive" element={<ProductReceivedPage />} />
        <Route path="spare-parts-po/:spoId/grn-detail" element={<SpareGeneratedGrnDetailPage />} />
        <Route path="spare-parts-po/:spoId/receive" element={<SparePartsProductReceivedPage />} />
        <Route path="spare-parts-po" element={<SparePartsPoPage />} />
        <Route path="serial-numbers" element={<SerialNumberPage />} />
        <Route path="replaced-products" element={<ReplacedProductsPage />} />

        <Route path="billing/vendor-overview" element={<BillingMonthlyPage view="overview" />} />
        <Route path="billing/pending" element={<BillingMonthlyPage view="pending" />} />
        <Route path="billing/approved" element={<BillingMonthlyPage view="approved" />} />
        <Route path="billing/completed" element={<BillingMonthlyPage view="completed" />} />

        <Route path="*" element={<Navigate to="/vendor-management" replace />} />
      </Routes>
      <VendorMgmtMobileNav />
    </div>
  );
}
