const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getRolePermissions, updateRolePermissions } = require('../controllers/rbacController');

router.get('/:role', authMiddleware, getRolePermissions);
router.put('/:role', authMiddleware, updateRolePermissions);

module.exports = router;
