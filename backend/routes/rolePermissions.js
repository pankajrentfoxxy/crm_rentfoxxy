const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const {
  getRolePermissions,
  updateRolePermissions,
  applyRoleDefaults,
} = require('../controllers/rbacController');

router.post('/:role/apply-defaults', authMiddleware, applyRoleDefaults);
router.get('/:role', authMiddleware, getRolePermissions);
router.put('/:role', authMiddleware, updateRolePermissions);

module.exports = router;
