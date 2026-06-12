import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import FinanceDashboardPage from './pages/FinanceDashboardPage';
import EInvoiceQueuePage from './pages/EInvoiceQueuePage';

export default function FinanceOverviewApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<FinanceDashboardPage />} />
      <Route path="einvoice-queue" element={<EInvoiceQueuePage />} />
    </Routes>
  );
}
