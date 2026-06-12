import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import VendorBillListPage from './pages/VendorBillListPage';
import VendorBillDetailPage from './pages/VendorBillDetailPage';
import DebitNotesPage from './pages/DebitNotesPage';

export default function VendorBillingApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="bills" replace />} />
      <Route path="bills" element={<VendorBillListPage />} />
      <Route path="bills/:billId" element={<VendorBillDetailPage />} />
      <Route path="debit-notes" element={<DebitNotesPage />} />
    </Routes>
  );
}
