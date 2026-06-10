import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import Teams from '../pages/Teams';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, action, element) {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

export const teamRoutes = [
  { path: '/teams', element: guard('teams', 'view', withLayout(<Teams />)) },
];
