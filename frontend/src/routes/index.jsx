import { publicRoutes } from './publicRoutes';
import { salesRoutes } from './salesRoutes';
import { supportRoutes } from './supportRoutes';
import { warehouseRoutes } from './warehouseRoutes';
import { teamRoutes } from './teamRoutes';
import { settingsRoutes } from './settingsRoutes';
import { operationManagementRoutes } from './operationManagementRoutes';
import { customerManagementRoutes } from './customerManagementRoutes';

export const appRoutes = [
  ...publicRoutes,
  ...salesRoutes,
  ...supportRoutes,
  ...warehouseRoutes,
  ...teamRoutes,
  ...settingsRoutes,
  ...operationManagementRoutes,
  ...customerManagementRoutes,
];

export {
  publicRoutes,
  salesRoutes,
  supportRoutes,
  warehouseRoutes,
  teamRoutes,
  settingsRoutes,
  operationManagementRoutes,
  customerManagementRoutes,
};
