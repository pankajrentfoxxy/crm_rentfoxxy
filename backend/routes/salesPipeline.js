/**
 * QC + Dispatch pipeline list endpoints (pagination + search).
 * Mounted as: app.use('/api', thisRouter)
 * → GET /api/sales/qc-pipeline-orders
 * → GET /api/sales/dispatch-pipeline-orders
 *
 * Injected automatically on deploy; see deploy/inject-sales-pipeline-routes.cjs
 */
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getQcPipelineOrders, getDispatchPipelineOrders } = require('../controllers/salesController');

router.use(authMiddleware);
router.get('/sales/qc-pipeline-orders', getQcPipelineOrders);
router.get('/sales/dispatch-pipeline-orders', getDispatchPipelineOrders);

module.exports = router;
