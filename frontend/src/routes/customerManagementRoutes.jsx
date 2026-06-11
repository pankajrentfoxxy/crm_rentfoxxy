import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

function RedirectCustomerDetail() {
  const { id } = useParams();
  return <Navigate to={`/lead-crm/customers/${id}`} replace />;
}

/** Legacy URLs redirect to Lead CRM — backend /api/customer-management/* unchanged */
export const customerManagementRoutes = [
  { path: '/customer-management/customers', element: <Navigate to="/lead-crm/customers" replace /> },
  { path: '/customer-management/customers/add', element: <Navigate to="/lead-crm/customers" replace /> },
  { path: '/customer-management/customers/:id', element: <RedirectCustomerDetail /> },
];
