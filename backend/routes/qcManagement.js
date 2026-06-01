/**
 * QC Management REST API — ported from Laravel admin qc/orders routes.
 * Base path: /api/qc-management
 */
const express = require('express');
const { authMiddleware, checkRoleOrPermission } = require('../middleware/auth');
const orders = require('../controllers/qcManagement/orders.controller');

const router = express.Router();

const authorize = [
  authMiddleware,
  checkRoleOrPermission(['admin', 'manager', 'floor_manager', 'qc'], ['qc_access'])
];

router.get('/', authorize, (req, res) =>
  res.json({
    success: true,
    module: 'QC Management',
    endpoints: [
      '/orders/counts',
      '/orders/:status',
      '/pending-orders/:poId',
      '/order-details',
      '/qc-check',
      '/hardware-qc-check'
    ]
  })
);

router.get('/orders/counts', authorize, orders.getStatusCounts);
router.get('/spare-parts', authorize, orders.listSpareParts);
router.get('/orders/:status', authorize, orders.listValidators, orders.listOrdersByStatus);
router.get(
  '/pending-orders/:poId/:status?',
  authorize,
  orders.pendingPoValidators,
  orders.listPendingProductsByPo
);
router.post('/order-details', authorize, orders.orderDetailsValidators, orders.getOrderDetails);
router.post('/qc-check', authorize, orders.qcCheckValidators, orders.qcCheck);
router.post('/hardware-qc-check', authorize, orders.hardwareQcValidators, orders.hardwareQcCheck);

module.exports = router;
