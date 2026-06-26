import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import FinanceDashboardPage from './pages/FinanceDashboardPage';
import EInvoiceQueuePage from './pages/EInvoiceQueuePage';

const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;

export default function FinanceOverviewApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={g('billing_dashboard', <FinanceDashboardPage />)} />
      <Route path="einvoice-queue" element={g('einvoice_ewb', <EInvoiceQueuePage />)} />
    </Routes>
  );
}
