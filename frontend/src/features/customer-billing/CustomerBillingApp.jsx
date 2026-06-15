import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import InvoiceListPage from './pages/InvoiceListPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import CreditNotesPage from './pages/CreditNotesPage';
import SecurityDepositsPage from './pages/SecurityDepositsPage';

// Per-page guards match the backend route guards exactly.
const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;

export default function CustomerBillingApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="invoices" replace />} />
      <Route path="invoices" element={g('customer_billing', <InvoiceListPage />)} />
      <Route path="invoices/:id" element={g('customer_billing', <InvoiceDetailPage />)} />
      <Route path="credit-notes" element={g('credit_notes', <CreditNotesPage />)} />
      <Route path="security-deposits" element={g('security_deposits', <SecurityDepositsPage />)} />
    </Routes>
  );
}
