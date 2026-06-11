import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useVendorAuth } from './context/VendorAuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import PurchaseOrderDetailPage from './pages/PurchaseOrderDetailPage';
import SerialNumbersPage from './pages/SerialNumbersPage';
import BillsPage from './pages/BillsPage';
import ReturnsPage from './pages/ReturnsPage';
import ProfilePage from './pages/ProfilePage';

function PrivateRoute({ children }) {
  const { isAuthenticated, loading } = useVendorAuth();
  if (loading) return <div className="p-12 text-center text-slate-500">Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="purchase-orders/:poId" element={<PurchaseOrderDetailPage />} />
        <Route path="laptops" element={<SerialNumbersPage />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="returns" element={<ReturnsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
