import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
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
import VendorRepairDcListPage from '../floor-pipeline/pages/VendorRepairDcListPage';
import VendorRepairDcDetailPage from '../floor-pipeline/pages/VendorRepairDcDetailPage';
import ReturnToVendorListPage from './pages/ReturnToVendorListPage';
import ReturnToVendorCreatePage from './pages/ReturnToVendorCreatePage';
import ReturnToVendorDetailPage from './pages/ReturnToVendorDetailPage';

const g = (section, node) => (
  <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>
);

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
        <Route path="vendors/:id" element={g('vendor_management', <VendorDetailPage />)} />
        <Route path="vendors" element={g('vendor_management', <VendorsPage />)} />

        <Route path="purchase-orders" element={g('vendor_management', <PurchaseOrdersPage />)} />
        <Route path="purchase-orders/:poId/grn-detail" element={g('vendor_management', <GeneratedGrnDetailPage />)} />
        <Route path="purchase-orders/:poId/receive" element={g('vendor_management', <ProductReceivedPage />)} />
        <Route path="spare-parts-po/:spoId/grn-detail" element={g('parts_procurement', <SpareGeneratedGrnDetailPage />)} />
        <Route path="spare-parts-po/:spoId/receive" element={g('parts_procurement', <SparePartsProductReceivedPage />)} />
        <Route path="spare-parts-po" element={g('parts_procurement', <SparePartsPoPage />)} />
        <Route path="serial-numbers" element={g('vendor_management', <SerialNumberPage />)} />
        <Route path="replaced-products" element={g('vendor_management', <ReplacedProductsPage />)} />

        <Route path="return-to-vendor/new" element={
          <ProtectedRoute sections={['vendor_return_to_vendor', 'vendor_management']} action="view">
            <ReturnToVendorCreatePage />
          </ProtectedRoute>
        } />
        <Route path="return-to-vendor/:dcNumber" element={
          <ProtectedRoute sections={['vendor_return_to_vendor', 'vendor_management']} action="view">
            <ReturnToVendorDetailPage />
          </ProtectedRoute>
        } />
        <Route path="return-to-vendor" element={
          <ProtectedRoute sections={['vendor_return_to_vendor', 'vendor_management']} action="view">
            <ReturnToVendorListPage />
          </ProtectedRoute>
        } />

        <Route
          path="vendor-repair-dc"
          element={
            <ProtectedRoute sections={['vendor_repair_dc', 'vendor_repair_dc_dispatch']} action="view">
              <VendorRepairDcListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="vendor-repair-dc/:dcNumber"
          element={
            <ProtectedRoute sections={['vendor_repair_dc', 'vendor_repair_dc_dispatch']} action="view">
              <VendorRepairDcDetailPage />
            </ProtectedRoute>
          }
        />

        <Route path="billing/vendor-overview" element={g('vendor_management', <BillingMonthlyPage view="overview" />)} />
        <Route path="billing/pending" element={g('vendor_management', <BillingMonthlyPage view="pending" />)} />
        <Route path="billing/approved" element={g('vendor_management', <BillingMonthlyPage view="approved" />)} />
        <Route path="billing/completed" element={g('vendor_management', <BillingMonthlyPage view="completed" />)} />

        <Route path="*" element={<Navigate to="/vendor-management" replace />} />
      </Routes>
      <VendorMgmtMobileNav />
    </div>
  );
}
