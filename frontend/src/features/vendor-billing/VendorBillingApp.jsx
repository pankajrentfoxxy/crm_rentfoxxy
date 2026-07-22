import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import VendorBillListPage from './pages/VendorBillListPage';
import VendorBillDetailPage from './pages/VendorBillDetailPage';
import DebitNotesPage from './pages/DebitNotesPage';

// Per-page guards match the backend route guards exactly.
const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;

export default function VendorBillingApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="bills" replace />} />
      <Route path="bills" element={g('vendor_billing_mgmt', <VendorBillListPage />)} />
      <Route path="bills/:billId" element={g('vendor_billing_mgmt', <VendorBillDetailPage />)} />
      <Route path="debit-notes" element={g('debit_notes', <DebitNotesPage />)} />
    </Routes>
  );
}
