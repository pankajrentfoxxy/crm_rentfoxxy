import React from 'react';
import ProtectedRoute from '../../router/ProtectedRoute';

/**
 * Finance → customer money (Builder 1, claude/carret-remaining-build.md).
 *
 * Each entry declares the section/action its API enforces in
 * backend/routes/customerBilling.js and is wrapped below with the same guard
 * carretRoutes.jsx uses (ProtectedRoute + Suspense).
 *
 * /carret/money/invoices and /carret/money/invoices/:invoiceId are already in
 * carretRoutes.jsx and open features/carret/InvoicesListPage /
 * InvoiceRecordPage, which were rebuilt in place — nothing to add for them.
 */
const PaymentsReceivedPage = React.lazy(() => import('../../features/carret/money/PaymentsReceivedPage'));
const CreditNotesPage = React.lazy(() => import('../../features/carret/money/CreditNotesPage'));
const CreditNoteFormPage = React.lazy(() => import('../../features/carret/money/CreditNoteFormPage'));
const CreditNoteRecordPage = React.lazy(() => import('../../features/carret/money/CreditNoteRecordPage'));
const SecurityDepositsPage = React.lazy(() => import('../../features/carret/money/SecurityDepositsPage'));
const DeliveryChargesPage = React.lazy(() => import('../../features/carret/money/DeliveryChargesPage'));

const guarded = ({ path, section, action, element }) => ({
  path,
  section,
  action,
  element: (
    <ProtectedRoute section={section} action={action}>
      <React.Suspense fallback={null}>{element}</React.Suspense>
    </ProtectedRoute>
  ),
});

const moneyCustomerRouteDefs = [
  // GET /customer-billing/payments — cp('customer_billing', 'view')
  { path: '/carret/money/payments', section: 'customer_billing', action: 'view', element: <PaymentsReceivedPage /> },
  // GET /customer-billing/credit-notes — cp('credit_notes', 'view')
  { path: '/carret/money/credit-notes', section: 'credit_notes', action: 'view', element: <CreditNotesPage /> },
  // POST /customer-billing/credit-notes — cp('credit_notes', 'create'). Declared before :id.
  { path: '/carret/money/credit-notes/new', section: 'credit_notes', action: 'create', element: <CreditNoteFormPage /> },
  // GET /customer-billing/credit-notes/:id — cp('credit_notes', 'view')
  { path: '/carret/money/credit-notes/:id', section: 'credit_notes', action: 'view', element: <CreditNoteRecordPage /> },
  // GET /customer-billing/security-deposits — cp('security_deposits', 'view')
  { path: '/carret/money/security-deposits', section: 'security_deposits', action: 'view', element: <SecurityDepositsPage /> },
  // GET /customer-billing/delivery-charges — cp('customer_billing', 'view')
  { path: '/carret/money/delivery-charges', section: 'customer_billing', action: 'view', element: <DeliveryChargesPage /> },
];

// Each page behind login + its section (the routes were spread unwrapped, so
// these six pages had no guard and no Suspense for their lazy chunk).
export const moneyCustomerRoutes = moneyCustomerRouteDefs.map(guarded);

export default moneyCustomerRoutes;
