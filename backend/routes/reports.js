const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { authMiddleware, checkRoleOrPermission } = require('../middleware/auth');

router.get(
    '/technician-performance',
    authMiddleware,
    checkRoleOrPermission(['admin', 'manager', 'floor_manager'], ['reports_access']),
    reportsController.getTechnicianPerformance
);

module.exports = router;
