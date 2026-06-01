import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import QcProcessingListPage from './pages/QcProcessingListPage';
import QcPassedListPage from './pages/QcPassedListPage';
import QcFailedListPage from './pages/QcFailedListPage';
import DeadAssetsListPage from './pages/DeadAssetsListPage';
import RequireForPartsPage from './pages/RequireForPartsPage';
import BundleManagementPage from './pages/BundleManagementPage';

/**
 * Nested routes only — navigation lives in Layout sidebar (accordion).
 */
export default function QCManagementApp() {
  return (
    <div className="min-w-0">
      <Routes>
        <Route
          index
          element={
            <div className="rounded-xl border bg-white shadow-sm p-8 space-y-3">
              <h1 className="text-2xl font-bold text-slate-900">QC Management</h1>
              <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
                Mirrors the Laravel admin Quality Check Management tree: processing, passed, failed, dead assets,
                require-for-parts queues, and bundle asset management.
              </p>
              <ul className="text-xs text-slate-500 grid sm:grid-cols-2 gap-2 mt-6">
                <li className="border rounded-lg p-4 bg-teal-50/40 border-teal-100">
                  Order lists at <code className="text-[11px]">admin/qc/orders/qc-orders/{'{status}'}</code>
                </li>
                <li className="border rounded-lg p-4 bg-slate-50">
                  Bundles at <code className="text-[11px]">admin/qc/qc-view-bundle-assets</code>
                </li>
              </ul>
            </div>
          }
        />

        <Route path="processing" element={<QcProcessingListPage />} />
        <Route path="passed" element={<QcPassedListPage />} />
        <Route path="failed" element={<QcFailedListPage />} />
        <Route path="dead-assets" element={<DeadAssetsListPage />} />
        <Route path="require-for-parts" element={<RequireForPartsPage />} />
        <Route path="bundle" element={<BundleManagementPage />} />

        <Route path="*" element={<Navigate to="/qc-management" replace />} />
      </Routes>
    </div>
  );
}
