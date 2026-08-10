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
import { SO_PERMISSION_SECTIONS } from './salesOrderScope';

const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;
const gSo = (node) => (
  <ProtectedRoute
    sections={[...SO_PERMISSION_SECTIONS, 'dispatch_workflow', 'dispatch_pending_orders']}
    action="view"
  >
    {node}
  </ProtectedRoute>
);

function SalesOrdersLegacyRedirect() {
  const { canView } = usePermission();
  if (canView('sales_orders_sale')) return <Navigate to="sales-orders-sale" replace />;
  if (canView('sales_orders_rental')) return <Navigate to="sales-orders-rental" replace />;
  if (canView('sales_orders_replacement')) return <Navigate to="sales-orders-replacement" replace />;
  if (canView('sales_orders_doc')) return <Navigate to="sales-orders-rental" replace />;
  return <Navigate to="/dashboard" replace />;
}

function SalesIndexRedirect() {
  const { canView } = usePermission();
  if (canView('sales_quotations')) return <Navigate to="quotations" replace />;
  if (canView('sales_orders_sale')) return <Navigate to="sales-orders-sale" replace />;
  if (canView('sales_orders_rental')) return <Navigate to="sales-orders-rental" replace />;
  if (canView('sales_orders_replacement')) return <Navigate to="sales-orders-replacement" replace />;
  if (canView('sales_orders_doc')) return <Navigate to="sales-orders-rental" replace />;
  if (canView('delivery_challans')) return <Navigate to="delivery-challans" replace />;
  if (canView('delivery_register_management')) return <Navigate to="delivery-register" replace />;
  if (canView('return_dc')) return <Navigate to="return-dc" replace />;
  if (canView('technician_bucket') || canView('delivery_my_deliveries')) {
    return <Navigate to="my-deliveries" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

export default function SalesPipelineApp() {
  return (
    <Routes>
      <Route index element={<SalesIndexRedirect />} />
      <Route path="quotations" element={g('sales_quotations', <QuotationListPage />)} />
      <Route path="quotations/:quotationNumber" element={g('sales_quotations', <QuotationDetailPage />)} />
      <Route path="sales-orders" element={<SalesOrdersLegacyRedirect />} />
      <Route path="sales-orders-sale" element={g('sales_orders_sale', <SalesOrderListPage scope="sale" />)} />
      <Route path="sales-orders-sale/*" element={gSo(<SalesOrderDetailPage scope="sale" />)} />
      <Route path="sales-orders-rental" element={g('sales_orders_rental', <SalesOrderListPage scope="rental" />)} />
      <Route path="sales-orders-rental/*" element={gSo(<SalesOrderDetailPage scope="rental" />)} />
      <Route path="sales-orders-replacement" element={g('sales_orders_replacement', <SalesOrderListPage scope="replacement" />)} />
      <Route path="sales-orders-replacement/*" element={gSo(<SalesOrderDetailPage scope="replacement" />)} />
      <Route path="sales-orders/*" element={gSo(<SalesOrderDetailPage />)} />
      <Route path="delivery-challans" element={g('delivery_challans', <DeliveryChallanListPage />)} />
      <Route
        path="delivery-challans/*"
        element={(
          <ProtectedRoute sections={[...SO_PERMISSION_SECTIONS, 'delivery_challans']} action="view">
            <DeliveryChallanDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route path="return-dc" element={g('return_dc', <ReturnDcListPage />)} />
      <Route path="delivery-register" element={g('delivery_register_management', <DeliveryRegisterPage />)} />
      <Route path="delivery-register/in-transit" element={g('delivery_register_management', <DeliveryRegisterPage />)} />
      <Route path="delivery-register/delivered" element={g('delivery_register_management', <DeliveryRegisterListPage />)} />
      <Route path="delivery-register/rejected" element={g('delivery_register_management', <DeliveryRegisterListPage />)} />
      <Route
        path="technician-bucket"
        element={(
          <ProtectedRoute sections={['technicians_bucket_list', 'technician_bucket']} action="view">
            <TechnicianBucketPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="my-deliveries"
        element={(
          <ProtectedRoute sections={['technician_bucket', 'delivery_my_deliveries']} action="view">
            <MyDeliveriesPage />
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<SalesIndexRedirect />} />
    </Routes>
  );
}
