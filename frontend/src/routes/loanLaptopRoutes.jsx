import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import LoanLaptopListPage from '../features/loan-laptops/pages/LoanLaptopListPage';
import LoanLaptopDetailPage from '../features/loan-laptops/pages/LoanLaptopDetailPage';
import LoanPolicyPage from '../features/loan-laptops/pages/LoanPolicyPage';

const withLayout = (node) => <Layout>{node}</Layout>;

// Support raise and track loans; Accounts approve from the same screens.
const LOAN_VIEW = ['loan_laptops', 'loan_laptop_approval'];

export const loanLaptopRoutes = [
  {
    path: '/loan-laptops',
    element: <ProtectedRoute sections={LOAN_VIEW} action="view">{withLayout(<LoanLaptopListPage />)}</ProtectedRoute>,
  },
  {
    path: '/loan-laptops/policy',
    element: (
      <ProtectedRoute sections={['loan_laptop_policy', ...LOAN_VIEW]} action="view">
        {withLayout(<LoanPolicyPage />)}
      </ProtectedRoute>
    ),
  },
  {
    path: '/loan-laptops/:id',
    element: <ProtectedRoute sections={LOAN_VIEW} action="view">{withLayout(<LoanLaptopDetailPage />)}</ProtectedRoute>,
  },
];
