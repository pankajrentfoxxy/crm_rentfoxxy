import React from 'react';
import Login from '../pages/Login';
import CustomerRegister from '../pages/auth/CustomerRegister';
import VendorRegister from '../pages/auth/VendorRegister';
import QuotationAccept from '../components/QuotationAccept';
import GrnSerialCapturePage from '../pages/GrnSerialCapturePage';
import Qc2ConfigMatchPage from '../pages/Qc2ConfigMatchPage';
import DispatchQcConfigMatchPage from '../pages/DispatchQcConfigMatchPage';
import AccessPage from '../features/access/AccessPage';
import HomeRedirect from '../router/HomeRedirect';
import UserImpersonateCallbackPage from '../pages/auth/UserImpersonateCallbackPage';
import CsatPage from '../pages/CsatPage';

export const publicRoutes = [
  { path: '/login', element: <Login /> },
  { path: '/auth/impersonate', element: <UserImpersonateCallbackPage /> },
  { path: '/register/customer', element: <CustomerRegister /> },
  { path: '/register/vendor', element: <VendorRegister /> },
  { path: '/quotation/accept/:token', element: <QuotationAccept /> },
  { path: '/grn-capture/:token', element: <GrnSerialCapturePage /> },
  { path: '/qc2-config-match', element: <Qc2ConfigMatchPage /> },
  { path: '/dispatch-qc-config-match', element: <DispatchQcConfigMatchPage /> },
  { path: '/access', element: <AccessPage /> },
  { path: '/csat/:token', element: <CsatPage /> },
  { path: '/', element: <HomeRedirect /> },
];

