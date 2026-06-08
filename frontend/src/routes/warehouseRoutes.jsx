import React from 'react';
import api from '../utils/api';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import Procurement from '../components/Procurement';
import Warehouse from '../components/Warehouse';
import Dispatch from '../components/Dispatch';
import QCOrders from '../components/QCOrders';
import VendorManagement from '../features/vendor-management/VendorManagementApp';
import QCManagement from '../features/qc-management/QCManagementApp';
import InventoryManagement from '../features/inventory-management/InventoryManagementApp';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, action, element) {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

export const warehouseRoutes = [
  { path: '/procurement', element: guard('procurement', 'view', withLayout(<Procurement api={api} />)) },
  { path: '/warehouse', element: guard('warehouse', 'view', withLayout(<Warehouse api={api} />)) },
  { path: '/qc-orders', element: guard('qc_management', 'view', withLayout(<QCOrders api={api} />)) },
  { path: '/dispatch', element: guard('dispatch', 'view', withLayout(<Dispatch api={api} />)) },
  { path: '/vendor-management/*', element: guard('vendor_management', 'view', withLayout(<VendorManagement />)) },
  { path: '/qc-management/*', element: guard('qc_management', 'view', withLayout(<QCManagement />)) },
  { path: '/inventory-management/*', element: guard('inventory_management', 'view', withLayout(<InventoryManagement />)) },
];
