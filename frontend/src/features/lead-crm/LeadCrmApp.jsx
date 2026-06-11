import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import LeadListPage from './pages/LeadListPage';
import LeadDetailPage from './pages/LeadDetailPage';
import FollowUpCalendarPage from './pages/FollowUpCalendarPage';
import CustomerListPage from './pages/CustomerListPage';
import CustomerDetailPage from './pages/CustomerDetailPage';

export default function LeadCrmApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="leads" replace />} />
      <Route path="leads" element={<LeadListPage />} />
      <Route path="leads/:id" element={<LeadDetailPage />} />
      <Route path="follow-ups" element={<FollowUpCalendarPage />} />
      <Route path="customers" element={<CustomerListPage />} />
      <Route path="customers/:id" element={<CustomerDetailPage />} />
      <Route path="*" element={<Navigate to="leads" replace />} />
    </Routes>
  );
}
