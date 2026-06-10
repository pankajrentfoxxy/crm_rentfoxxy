const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const {
  getUserPermissions,
  updateUserPermissionsById,
  resetUserPermissionsById,
} = require('../controllers/rbacController');

router.get('/:userId', authMiddleware, getUserPermissions);
router.put('/:userId', authMiddleware, updateUserPermissionsById);
router.delete('/:userId/reset', authMiddleware, resetUserPermissionsById);

module.exports = router;
