import React from 'react';
import Login from '../pages/Login';
import CustomerRegister from '../pages/auth/CustomerRegister';
import VendorRegister from '../pages/auth/VendorRegister';
import QuotationAccept from '../components/QuotationAccept';
import { Navigate } from 'react-router-dom';

export const publicRoutes = [
  { path: '/login', element: <Login /> },
  { path: '/register/customer', element: <CustomerRegister /> },
  { path: '/register/vendor', element: <VendorRegister /> },
  { path: '/quotation/accept/:token', element: <QuotationAccept /> },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
];
