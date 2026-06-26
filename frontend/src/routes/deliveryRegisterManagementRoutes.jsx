import React from 'react';
import { Navigate } from 'react-router-dom';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import DeliveryTechniciansPage from '../pages/delivery-register-management/DeliveryTechniciansPage';
import DeliveryTechnicianFormPage from '../pages/delivery-register-management/DeliveryTechnicianFormPage';
import TechniciansBucketListPage from '../pages/delivery-register-management/TechniciansBucketListPage';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, element, action = 'view') {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

// The register LIST + technician bucket here duplicated the canonical
// /sales-pipeline/delivery-register and /sales-pipeline/technician-bucket, so
// they now redirect. The technician master-data CRUD pages are unique and stay.
export const deliveryRegisterManagementRoutes = [
  { path: '/delivery-register-management', element: <Navigate to="/sales-pipeline/delivery-register" replace /> },
  { path: '/delivery-register-management/in-transit', element: <Navigate to="/sales-pipeline/delivery-register" replace /> },
  { path: '/delivery-register-management/delivered', element: <Navigate to="/sales-pipeline/delivery-register/delivered" replace /> },
  { path: '/delivery-register-management/rejected', element: <Navigate to="/sales-pipeline/delivery-register/rejected" replace /> },
  { path: '/delivery-register-management/bucket-list', element: guard('technicians_bucket_list', withLayout(<TechniciansBucketListPage />)) },
  {
    path: '/delivery-register-management/technicians',
    element: guard('delivery_register_management', withLayout(<DeliveryTechniciansPage />)),
  },
  {
    path: '/delivery-register-management/technicians/add',
    element: guard('delivery_register_management', withLayout(<DeliveryTechnicianFormPage />), 'create'),
  },
  {
    path: '/delivery-register-management/technicians/:id/edit',
    element: guard('delivery_register_management', withLayout(<DeliveryTechnicianFormPage />), 'edit'),
  },
];
