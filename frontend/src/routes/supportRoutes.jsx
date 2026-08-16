import React from 'react';
import { Navigate } from 'react-router-dom';
import { supportPartsRoute } from './supportV2Routes';

export const supportRoutes = [
  {
    path: '/customer-inventory',
    element: <Navigate to="/lead-crm/customers" replace />,
  },
  supportPartsRoute,
];
