import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import usePermission from '../../hooks/usePermission';
import QuotationListPage from './pages/QuotationListPage';
import QuotationDetailPage from './pages/QuotationDetailPage';
import SalesOrderListPage from './pages/SalesOrderListPage';
import SalesOrderDetailPage from './pages/SalesOrderDetailPage';
import DeliveryChallanListPage from './pages/DeliveryChallanListPage';
import DeliveryChallanDetailPage from './pages/DeliveryChallanDetailPage';
import ReturnDcListPage from './pages/ReturnDcListPage';
import DeliveryRegisterPage from './pages/DeliveryRegisterPage';
import DeliveryRegisterListPage from '../../pages/delivery-register-management/DeliveryRegisterListPage';
import TechnicianBucketPage from './pages/TechnicianBucketPage';
import MyDeliveriesPage from './pages/MyDeliveriesPage';

// Per-page guards match each backend API's granular section.
const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;

// Land on the first sales-pipeline page the user can actually open.
function SalesIndexRedirect() {
  const { canView } = usePermission();
  if (canView('sales_quotations')) return <Navigate to="quotations" replace />;
  if (canView('sales_orders_doc')) return <Navigate to="sales-orders" replace />;
  if (canView('delivery_challans')) return <Navigate to="delivery-challans" replace />;
  if (canView('delivery_register_management')) return <Navigate to="delivery-register" replace />;
  if (canView('return_dc')) return <Navigate to="return-dc" replace />;
  if (canView('technician_bucket')) return <Navigate to="my-deliveries" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function SalesPipelineApp() {
  return (
    <Routes>
      <Route index element={<SalesIndexRedirect />} />
      <Route path="quotations" element={g('sales_quotations', <QuotationListPage />)} />
      <Route path="quotations/:quotationNumber" element={g('sales_quotations', <QuotationDetailPage />)} />
      <Route path="sales-orders" element={g('sales_orders_doc', <SalesOrderListPage />)} />
      <Route path="sales-orders/*" element={g('sales_orders_doc', <SalesOrderDetailPage />)} />
      <Route path="delivery-challans" element={g('delivery_challans', <DeliveryChallanListPage />)} />
      <Route path="delivery-challans/*" element={g('delivery_challans', <DeliveryChallanDetailPage />)} />
      <Route path="return-dc" element={g('return_dc', <ReturnDcListPage />)} />
      <Route path="delivery-register" element={g('delivery_register_management', <DeliveryRegisterPage />)} />
      <Route path="delivery-register/in-transit" element={g('delivery_register_management', <DeliveryRegisterPage />)} />
      <Route path="delivery-register/delivered" element={g('delivery_register_management', <DeliveryRegisterListPage />)} />
      <Route path="delivery-register/rejected" element={g('delivery_register_management', <DeliveryRegisterListPage />)} />
      <Route path="technician-bucket" element={g('technician_bucket', <TechnicianBucketPage />)} />
      <Route path="my-deliveries" element={g('technician_bucket', <MyDeliveriesPage />)} />
      <Route path="*" element={<SalesIndexRedirect />} />
    </Routes>
  );
}
