import React from 'react';
import { Navigate } from 'react-router-dom';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import LaptopConfigurationPage from '../pages/admin/settings/LaptopConfigurationPage';
import SparePartsConfigurationPage from '../pages/admin/settings/SparePartsConfigurationPage';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, action, element) {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

export const assetConfigurationRoutes = [
  { path: '/asset-configuration', element: <Navigate to="/asset-configuration/laptop" replace /> },
  {
    path: '/asset-configuration/laptop',
    element: guard('asset_configuration', 'view', withLayout(<LaptopConfigurationPage />)),
  },
  {
    path: '/asset-configuration/spare-parts',
    element: guard('asset_configuration', 'view', withLayout(<SparePartsConfigurationPage />)),
  },
  { path: '/settings/asset-configuration', element: <Navigate to="/asset-configuration/laptop" replace /> },
];
