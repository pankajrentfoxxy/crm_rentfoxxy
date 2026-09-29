import React from 'react';

/**
 * Finance → customer money (Builder 1, claude/carret-remaining-build.md).
 *
 * Each entry declares the section/action its API enforces in
 * backend/routes/customerBilling.js; the lead wraps them with the same guard()
 * used in carretRoutes.jsx (ProtectedRoute + Suspense).
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

export const moneyCustomerRoutes = [
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

export default moneyCustomerRoutes;
