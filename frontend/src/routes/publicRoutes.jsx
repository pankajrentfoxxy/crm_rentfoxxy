import React from 'react';
import Login from '../pages/Login';
import CustomerRegister from '../pages/auth/CustomerRegister';
import VendorRegister from '../pages/auth/VendorRegister';
import QuotationAccept from '../components/QuotationAccept';
import GrnSerialCapturePage from '../pages/GrnSerialCapturePage';
import HomeRedirect from '../router/HomeRedirect';

export const publicRoutes = [
  { path: '/login', element: <Login /> },
  { path: '/register/customer', element: <CustomerRegister /> },
  { path: '/register/vendor', element: <VendorRegister /> },
  { path: '/quotation/accept/:token', element: <QuotationAccept /> },
  { path: '/grn-capture/:token', element: <GrnSerialCapturePage /> },
  // Permission-aware landing — routes each role to their first accessible module.
  { path: '/', element: <HomeRedirect /> },
];
