const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const {
  listAllRolePermissionsLegacy,
  patchAllRolePermissionsLegacy,
} = require('../controllers/rbacController');

router.get('/roles', authMiddleware, listAllRolePermissionsLegacy);
router.patch('/roles', authMiddleware, patchAllRolePermissionsLegacy);

module.exports = router;
