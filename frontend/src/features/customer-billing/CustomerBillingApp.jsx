import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import InvoiceListPage from './pages/InvoiceListPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import CreditNotesPage from './pages/CreditNotesPage';
import SecurityDepositsPage from './pages/SecurityDepositsPage';

export default function CustomerBillingApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="invoices" replace />} />
      <Route path="invoices" element={<InvoiceListPage />} />
      <Route path="invoices/:id" element={<InvoiceDetailPage />} />
      <Route path="credit-notes" element={<CreditNotesPage />} />
      <Route path="security-deposits" element={<SecurityDepositsPage />} />
    </Routes>
  );
}
