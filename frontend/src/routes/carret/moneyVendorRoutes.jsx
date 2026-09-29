import React from 'react';
import ProtectedRoute from '../../router/ProtectedRoute';

/**
 * Finance → Vendors (Builder 2): vendor bills, debit notes, vendor payments.
 *
 * Each entry names the section/action its API enforces (routes/vendorBilling.js)
 * and carries a ready guarded element, the same guard carretRoutes.jsx uses.
 * The lead spreads this array into carretRoutes behind CARRET_ENABLED.
 */
const VendorBillsListPage = React.lazy(() => import('../../features/carret/money/vendor/VendorBillsListPage'));
const VendorBillRecordPage = React.lazy(() => import('../../features/carret/money/vendor/VendorBillRecordPage'));
const DebitNotesListPage = React.lazy(() => import('../../features/carret/money/vendor/DebitNotesListPage'));
const DebitNoteRecordPage = React.lazy(() => import('../../features/carret/money/vendor/DebitNoteRecordPage'));
const VendorPaymentsPage = React.lazy(() => import('../../features/carret/money/vendor/VendorPaymentsPage'));

const guard = (section, action, node) => (
  <ProtectedRoute section={section} action={action}>
    <React.Suspense fallback={null}>{node}</React.Suspense>
  </ProtectedRoute>
);

const entry = (path, section, action, node) => ({ path, section, action, element: guard(section, action, node) });

export const moneyVendorRoutes = [
  entry('/carret/money/vendor-bills', 'vendor_billing_mgmt', 'view', <VendorBillsListPage />),
  entry('/carret/money/vendor-bills/:billId', 'vendor_billing_mgmt', 'view', <VendorBillRecordPage />),
  entry('/carret/money/debit-notes', 'debit_notes', 'view', <DebitNotesListPage />),
  entry('/carret/money/debit-notes/:id', 'debit_notes', 'view', <DebitNoteRecordPage />),
  entry('/carret/money/vendor-payments', 'vendor_billing_mgmt', 'view', <VendorPaymentsPage />),
];

export default moneyVendorRoutes;
