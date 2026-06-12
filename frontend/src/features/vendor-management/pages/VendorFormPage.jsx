import { Navigate } from 'react-router-dom';

/**
 * Laravel used separate routes for add/edit. CRM vendors are edited in-place via modal on `/vendor-management/vendors`.
 */
export default function VendorFormPage() {
  return <Navigate to="/vendor-management/vendors" replace />;
}
