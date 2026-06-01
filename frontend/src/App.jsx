import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import Inventory from './components/Inventory';
import CustomerInventory from './components/CustomerInventory';
import SupportApp from './components/support/SupportApp';
import PartsInventory from './components/PartsInventory';
import SupportProtectedRoute from './router/SupportProtectedRoute';
import Reports from './components/Reports';
import Procurement from './components/Procurement';
import Warehouse from './components/Warehouse';
import Dispatch from './components/Dispatch';
import Sales from './components/Sales';
import LeadList from './components/LeadList';
import LeadDetail from './components/LeadDetail';
import QuotationAccept from './components/QuotationAccept';
import FollowUps from './components/FollowUps';
import ManagerDashboard from './components/ManagerDashboard';
import Orders from './components/Orders';
import QCOrders from './components/QCOrders';
import Customers from './components/Customers'; 
import './App.css';
import ProtectedRoute from './router/ProtectedRoute';
import api from './utils/api';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Teams from './pages/Teams';
import TicketsList from './pages/tickets/TicketsList';
import CreateTicket from './pages/tickets/CreateTicket';
import TicketDetails from './pages/tickets/TicketDetails';
import { Toaster } from 'react-hot-toast';
import VendorManagement from './features/vendor-management/VendorManagementApp';
import QCManagement from './features/qc-management/QCManagementApp';
import InventoryManagement from './features/inventory-management/InventoryManagementApp';


// Main App
function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster position="top-right" toastOptions={{ className: 'text-sm', duration: 4500 }} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/quotation/accept/:token" element={<QuotationAccept />} />
          <Route path="/" element={<Navigate to="/dashboard" />} />
          <Route path="/dashboard" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'floor_manager']} allowedPermissions={['reports_access']}><Layout><Reports api={api} /></Layout></ProtectedRoute>} />
          <Route path="/inventory" element={
            <ProtectedRoute allowedRoles={['manager', 'admin', 'floor_manager']} allowedPermissions={['inventory_read', 'inventory_write', 'inventory_access']}>
              <Layout>
                <div className="p-6">
                  <Inventory api={api} />
                </div>
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/customer-inventory" element={
            <ProtectedRoute allowedRoles={['manager', 'admin', 'floor_manager', 'support_lead', 'support_tech']} allowedPermissions={['customer_inventory_access']}>
              <Layout>
                <div className="p-6">
                  <CustomerInventory api={api} />
                </div>
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/support/*" element={
            <SupportProtectedRoute>
              <SupportApp />
            </SupportProtectedRoute>
          } />
          <Route path="/tickets" element={<ProtectedRoute><Layout><TicketsList /></Layout></ProtectedRoute>} />
          <Route path="/tickets/:id" element={<ProtectedRoute><Layout><TicketDetails /></Layout></ProtectedRoute>} />
          <Route path="/tickets/create" element={
            <ProtectedRoute allowedRoles={['admin', 'manager', 'floor_manager']}>
              <Layout><CreateTicket /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/parts" element={<ProtectedRoute><Layout><PartsInventory /></Layout></ProtectedRoute>} />
          <Route path="/sales" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><Sales api={api} /></Layout></ProtectedRoute>} />
          <Route path="/leads" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><LeadList api={api} /></Layout></ProtectedRoute>} />
          <Route path="/leads/:id" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><LeadDetail api={api} /></Layout></ProtectedRoute>} />
          <Route path="/follow-ups" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><FollowUps api={api} /></Layout></ProtectedRoute>} />
          <Route path="/lead-orders" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><Orders api={api} /></Layout></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><Customers api={api} /></Layout></ProtectedRoute>} />
          <Route path="/manager-dashboard" element={<ProtectedRoute allowedRoles={['admin', 'manager']}><Layout><ManagerDashboard api={api} /></Layout></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><Orders api={api} /></Layout></ProtectedRoute>} />
          <Route path="/procurement" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'procurement']} allowedPermissions={['procurement_access']}><Layout><Procurement api={api} /></Layout></ProtectedRoute>} />
          <Route path="/warehouse" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'warehouse']} allowedPermissions={['warehouse_access']}><Layout><Warehouse api={api} /></Layout></ProtectedRoute>} />
          <Route path="/qc-orders" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'floor_manager', 'qc']} allowedPermissions={['qc_access']}><Layout><QCOrders api={api} /></Layout></ProtectedRoute>} />
          <Route path="/dispatch" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'floor_manager', 'dispatch']} allowedPermissions={['dispatch_access']}><Layout><Dispatch api={api} /></Layout></ProtectedRoute>} />
          <Route path="/teams" element={<ProtectedRoute><Layout><Teams /></Layout></ProtectedRoute>} />
          <Route
            path="/vendor-management/*"
            element={
              <ProtectedRoute allowedRoles={['admin', 'manager', 'procurement']} allowedPermissions={['vendor_management_access']}>
                <Layout>
                  <VendorManagement />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/qc-management/*"
            element={
              <ProtectedRoute allowedRoles={['admin', 'manager', 'floor_manager', 'qc']} allowedPermissions={['qc_access']}>
                <Layout>
                  <QCManagement />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventory-management/*"
            element={
              <ProtectedRoute
                allowedRoles={['admin', 'manager', 'floor_manager']}
                allowedPermissions={['inventory_read', 'inventory_write', 'inventory_access', 'inventory_management_access']}
              >
                <Layout>
                  <InventoryManagement />
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
