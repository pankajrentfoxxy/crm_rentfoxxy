import React from 'react';
import { Navigate } from 'react-router-dom';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import QuotationsListPage from '../pages/operation-management/QuotationsListPage';
import QuotationAddPage from '../pages/operation-management/QuotationAddPage';
import SalesOrdersListPage from '../pages/operation-management/SalesOrdersListPage';
import SalesOrderAddPage from '../pages/operation-management/SalesOrderAddPage';
import DeliveryChallansListPage from '../pages/operation-management/DeliveryChallansListPage';
import DeliveryChallanAddPage from '../pages/operation-management/DeliveryChallanAddPage';
import DeliveryRegisterPage from '../pages/operation-management/DeliveryRegisterPage';
import ReturnDcListPage from '../pages/operation-management/ReturnDcListPage';
import DemoAgreementsPage from '../pages/demo/DemoAgreementsPage';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, element, action = 'view') {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

export const operationManagementRoutes = [
  { path: '/sales-management/*', element: <Navigate to="/operation-management/quotations" replace /> },
  { path: '/operation-management/quotations', element: guard('sales_quotations', withLayout(<QuotationsListPage />)) },
  { path: '/operation-management/quotations/add', element: guard('sales_quotations', withLayout(<QuotationAddPage />), 'create') },
  { path: '/operation-management/sales-orders', element: guard('sales_orders_doc', withLayout(<SalesOrdersListPage />)) },
  { path: '/operation-management/sales-orders/add', element: guard('sales_orders_doc', withLayout(<SalesOrderAddPage />), 'create') },
  { path: '/operation-management/delivery-challans', element: guard('delivery_challans', withLayout(<DeliveryChallansListPage />)) },
  { path: '/operation-management/delivery-challans/add', element: guard('delivery_challans', withLayout(<DeliveryChallanAddPage />), 'create') },
  { path: '/operation-management/delivery-challans/:dcNumber/register', element: guard('delivery_challans', withLayout(<DeliveryRegisterPage />), 'edit') },
  { path: '/operation-management/return-dc', element: guard('return_dc', withLayout(<ReturnDcListPage />)) },
  { path: '/sales-pipeline/demo', element: guard('demo_management', withLayout(<DemoAgreementsPage />)) },
];
