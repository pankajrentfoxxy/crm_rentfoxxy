import React from 'react';
import { Navigate } from 'react-router-dom';

const PARTS_INVENTORY_PATH = '/inventory-management/parts';

export default function PartsRedirect() {
  return <Navigate to={PARTS_INVENTORY_PATH} replace />;
}
