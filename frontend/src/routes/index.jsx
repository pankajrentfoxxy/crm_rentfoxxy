import { publicRoutes } from './publicRoutes';
import { salesRoutes } from './salesRoutes';
import { supportRoutes } from './supportRoutes';
import { warehouseRoutes } from './warehouseRoutes';
import { teamRoutes } from './teamRoutes';
import { settingsRoutes } from './settingsRoutes';
import { operationManagementRoutes } from './operationManagementRoutes';
import { customerManagementRoutes } from './customerManagementRoutes';
import { deliveryRegisterManagementRoutes } from './deliveryRegisterManagementRoutes';
import { technicianRoutes } from './technicianRoutes';
import { financeRoutes } from './financeRoutes';
import { reportingRoutes } from './reportingRoutes';
import { assetConfigurationRoutes } from './assetConfigurationRoutes';
import { dispatchRoutes } from './dispatchRoutes';
import { guardRoutes } from './guardRoutes';

export const appRoutes = [
  ...publicRoutes,
  ...salesRoutes,
  ...dispatchRoutes,
  ...guardRoutes,
  ...supportRoutes,
  ...warehouseRoutes,
  ...teamRoutes,
  ...settingsRoutes,
  ...assetConfigurationRoutes,
  ...operationManagementRoutes,
  ...customerManagementRoutes,
  ...deliveryRegisterManagementRoutes,
  ...technicianRoutes,
  ...financeRoutes,
  ...reportingRoutes,
];

export {
  publicRoutes,
  salesRoutes,
  dispatchRoutes,
  guardRoutes,
  supportRoutes,
  warehouseRoutes,
  teamRoutes,
  settingsRoutes,
  operationManagementRoutes,
  customerManagementRoutes,
  deliveryRegisterManagementRoutes,
  technicianRoutes,
  financeRoutes,
  reportingRoutes,
  assetConfigurationRoutes,
};
