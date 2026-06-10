import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import CustomersListPage from '../pages/customer-management/CustomersListPage';
import CustomerAddPage from '../pages/customer-management/CustomerAddPage';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, element, action = 'view') {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

export const customerManagementRoutes = [
  { path: '/customer-management/customers', element: guard('customer_management', withLayout(<CustomersListPage />)) },
  { path: '/customer-management/customers/add', element: guard('customer_management', withLayout(<CustomerAddPage />), 'create') },
];
