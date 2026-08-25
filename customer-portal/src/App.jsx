import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import LaptopsPage from './pages/LaptopsPage';
import OrdersPage from './pages/OrdersPage';
import OrderDetailPage from './pages/OrderDetailPage';
import InvoicesPage from './pages/InvoicesPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import CreditNotesPage from './pages/CreditNotesPage';
import DeliveriesPage from './pages/DeliveriesPage';
import DeliveryDetailPage from './pages/DeliveryDetailPage';
import SupportTicketsPage from './pages/SupportTicketsPage';
import TicketDetailPage from './pages/TicketDetailPage';
import CreateTicketPage from './pages/CreateTicketPage';
import ProfilePage from './pages/ProfilePage';

/**
 * `/support` used to be the combined form + list page. Existing links (including
 * the ones we mailed out) carry `?ttspl=` / `?type=`, so those still open the
 * create form; everything else lands on the ticket list.
 */
function SupportRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const wantsForm = params.has('ttspl') || params.has('type');
  return <Navigate to={`/support/${wantsForm ? 'new' : 'tickets'}${search}`} replace />;
}

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
        <Route path="orders/:soNumber" element={<OrderDetailPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/:invoiceId" element={<InvoiceDetailPage />} />
        <Route path="credit-notes" element={<CreditNotesPage />} />
        <Route path="deliveries" element={<DeliveriesPage />} />
        <Route path="deliveries/:dcNumber" element={<DeliveryDetailPage />} />
        <Route path="support" element={<SupportRedirect />} />
        <Route path="support/tickets" element={<SupportTicketsPage />} />
        <Route path="support/tickets/:ticketId" element={<TicketDetailPage />} />
        <Route path="support/new" element={<CreateTicketPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
