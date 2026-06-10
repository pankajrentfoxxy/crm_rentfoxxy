const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getPermissionSections,
} = require('../controllers/rbacController');

router.get('/sections', authMiddleware, getPermissionSections);
router.get('/', authMiddleware, listRoles);
router.post('/', authMiddleware, createRole);
router.put('/:id', authMiddleware, updateRole);
router.delete('/:id', authMiddleware, deleteRole);

module.exports = router;
