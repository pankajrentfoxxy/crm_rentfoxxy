import React, { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import LaptopsPage from './pages/LaptopsPage';
import OrdersPage from './pages/OrdersPage';
import InvoicesPage from './pages/InvoicesPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import CreditNotesPage from './pages/CreditNotesPage';
import DeliveriesPage from './pages/DeliveriesPage';
import SupportPage from './pages/SupportPage';
import ProfilePage from './pages/ProfilePage';

export default function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <div className="p-12 text-center text-slate-500">Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="laptops" element={<LaptopsPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/:invoiceId" element={<InvoiceDetailPage />} />
        <Route path="credit-notes" element={<CreditNotesPage />} />
        <Route path="deliveries" element={<DeliveriesPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
