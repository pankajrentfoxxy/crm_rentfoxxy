import React from 'react';
import { Navigate } from 'react-router-dom';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import DeliveryRegisterListPage from '../pages/delivery-register-management/DeliveryRegisterListPage';
import DeliveryTechniciansPage from '../pages/delivery-register-management/DeliveryTechniciansPage';
import DeliveryTechnicianFormPage from '../pages/delivery-register-management/DeliveryTechnicianFormPage';
import TechniciansBucketListPage from '../pages/delivery-register-management/TechniciansBucketListPage';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, element, action = 'view') {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

const listPage = guard('delivery_register_management', withLayout(<DeliveryRegisterListPage />));

export const deliveryRegisterManagementRoutes = [
  {
    path: '/delivery-register-management',
    element: <Navigate to="/delivery-register-management/in-transit" replace />,
  },
  { path: '/delivery-register-management/in-transit', element: listPage },
  { path: '/delivery-register-management/delivered', element: listPage },
  { path: '/delivery-register-management/rejected', element: listPage },
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
  {
    path: '/delivery-register-management/bucket-list',
    element: guard('technicians_bucket_list', withLayout(<TechniciansBucketListPage />)),
  },
];
