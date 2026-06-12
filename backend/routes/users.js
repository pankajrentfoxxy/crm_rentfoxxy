const express = require('express');
const router = express.Router();
const { updateUserPermissions } = require('../controllers/authController');
const { getUserPermissions } = require('../controllers/rbacController');
const { authMiddleware } = require('../middleware/auth');
const { getUsersByRole } = require('../controllers/rbacController');

router.get('/by-role/:role', authMiddleware, getUsersByRole);
router.get('/:id/permissions', authMiddleware, getUserPermissions);
router.put('/:id/permissions', authMiddleware, updateUserPermissions);

module.exports = router;
