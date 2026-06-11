import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import QuotationListPage from './pages/QuotationListPage';
import QuotationDetailPage from './pages/QuotationDetailPage';
import SalesOrderListPage from './pages/SalesOrderListPage';
import SalesOrderDetailPage from './pages/SalesOrderDetailPage';
import DeliveryChallanListPage from './pages/DeliveryChallanListPage';
import DeliveryChallanDetailPage from './pages/DeliveryChallanDetailPage';
import ReturnDcListPage from './pages/ReturnDcListPage';
import DeliveryRegisterPage from './pages/DeliveryRegisterPage';

export default function SalesPipelineApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="quotations" replace />} />
      <Route path="quotations" element={<QuotationListPage />} />
      <Route path="quotations/:quotationNumber" element={<QuotationDetailPage />} />
      <Route path="sales-orders" element={<SalesOrderListPage />} />
      <Route path="sales-orders/:soNumber" element={<SalesOrderDetailPage />} />
      <Route path="delivery-challans" element={<DeliveryChallanListPage />} />
      <Route path="delivery-challans/:dcNumber" element={<DeliveryChallanDetailPage />} />
      <Route path="return-dc" element={<ReturnDcListPage />} />
      <Route path="delivery-register" element={<DeliveryRegisterPage />} />
    </Routes>
  );
}
