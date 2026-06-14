import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import LeadListPage from './pages/LeadListPage';
import LeadDetailPage from './pages/LeadDetailPage';
import FollowUpCalendarPage from './pages/FollowUpCalendarPage';
import CustomerListPage from './pages/CustomerListPage';
import CustomerDetailPage from './pages/CustomerDetailPage';

// Per-page guards so each sub-page matches its own permission section
// (the outer /lead-crm/* route only checks the leads|customers|follow_ups umbrella).
const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;

export default function LeadCrmApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="leads" replace />} />
      <Route path="leads" element={g('leads', <LeadListPage />)} />
      <Route path="leads/:id" element={g('leads', <LeadDetailPage />)} />
      <Route path="follow-ups" element={g('follow_ups', <FollowUpCalendarPage />)} />
      <Route path="customers" element={g('customers', <CustomerListPage />)} />
      <Route path="customers/:id" element={g('customers', <CustomerDetailPage />)} />
      <Route path="*" element={<Navigate to="leads" replace />} />
    </Routes>
  );
}
