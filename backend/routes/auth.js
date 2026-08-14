const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getCurrentUser,
  getAllUsers,
  exportUsersCsv,
  exportUsersExcel,
  loginBarcode,
  updateBarcode,
  updateMobile,
  updateUserTeams,
  updateUserPermissions,
  deleteUser,
  updateUser,
  updateUserStatus,
  resetUserPassword,
  backfillUserRememberPass,
  loginAsUser,
  registerCustomer,
  registerVendor,
  registerTechnician,
  approveVendor,
  getPendingVendors,
  getTeams,
  requestForgotPasswordOtp,
  resetPasswordWithOtp,
} = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');
const { unifiedLogin } = require('../controllers/unifiedLoginController');

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Private (manager/admin/superadmin enforced in controller)
router.post('/register', authMiddleware, register);

// @route   POST /api/auth/unified-login
// @desc    Single login for CRM / vendor / customer — routes by credentials
// @access  Public
router.post('/unified-login', unifiedLogin);
router.post('/login-unified', unifiedLogin); // alias

// @route   GET /api/auth/debug
// @desc    Debug connection (remove in production)
// @access  Public
router.get('/debug', async (req, res) => {
  try {
    const pool = require('../config/db');
    await pool.query('SELECT 1');
    const hasJwt = !!process.env.JWT_SECRET;
    const userCount = await pool.query('SELECT COUNT(*) FROM public.users WHERE email = $1', ['admin@rentfoxxy.com']);
    res.json({
      db: 'ok',
      jwtSecret: hasJwt ? 'set' : 'MISSING',
      adminExists: parseInt(userCount.rows[0].count) > 0
    });
  } catch (err) {
    res.status(500).json({ db: 'fail', error: err.message });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', login);

// @route   POST /api/auth/forgot-password/request
// @desc    Send password reset OTP to email
// @access  Public
router.post('/forgot-password/request', requestForgotPasswordOtp);

// @route   POST /api/auth/forgot-password/reset
// @desc    Verify OTP and set new password
// @access  Public
router.post('/forgot-password/reset', resetPasswordWithOtp);

// @route   POST /api/auth/register/customer
// @desc    Public customer self-registration
// @access  Public
router.post('/register/customer', registerCustomer);

// @route   POST /api/auth/register/vendor
// @desc    Public vendor self-registration (pending approval)
// @access  Public
router.post('/register/vendor', registerVendor);

// @route   POST /api/auth/register/technician
// @desc    Register technician with per-user RBAC overrides
// @access  Private (admin/super_admin)
router.post('/register/technician', authMiddleware, registerTechnician);

// @route   GET /api/auth/vendors/pending
// @desc    List vendors awaiting approval
// @access  Private (admin/super_admin)
router.get('/vendors/pending', authMiddleware, getPendingVendors);

// @route   POST /api/auth/vendors/:id/approve
// @desc    Approve or reject a vendor registration
// @access  Private (super_admin)
router.post('/vendors/:id/approve', authMiddleware, approveVendor);

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', authMiddleware, getCurrentUser);

// @route   POST /api/auth/login-barcode
// @desc    Login with barcode
// @access  Public
router.post('/login-barcode', loginBarcode);

// @route   PUT /api/auth/users/:id/barcode
// @desc    Update user barcode
// @access  Private (Admin/Manager)
router.put('/users/:id/barcode', authMiddleware, updateBarcode);

// @route   PUT /api/auth/users/:id/mobile
// @desc    Update user mobile number
// @access  Private (Admin/Manager)
router.put('/users/:id/mobile', authMiddleware, updateMobile);

// @route   PUT /api/auth/users/:id/teams
// @desc    Update user team assignments (multi-team for team_member/team_lead)
// @access  Private (Admin/Manager)
router.put('/users/:id/teams', authMiddleware, updateUserTeams);

// @route   GET /api/auth/teams
// @desc    List teams for user assignment
// @access  Private
router.get('/teams', authMiddleware, getTeams);

// @route   GET /api/auth/users
// @desc    Get all users (Manager/Admin)
// @access  Private
router.get('/users', authMiddleware, getAllUsers);

// @route   GET /api/auth/users/export-csv
// @desc    Export users as CSV (respects list filters)
// @access  Private (users view permission)
router.get('/users/export-csv', authMiddleware, exportUsersCsv);

// @route   GET /api/auth/users/export.xlsx
// @desc    Export users as Excel with bcrypt password hash (admin only)
// @access  Private (admin/super_admin)
router.get('/users/export.xlsx', authMiddleware, exportUsersExcel);

// @route   PUT /api/auth/users/:id
// @desc    Update user profile and role
// @access  Private (Admin/Manager)
router.put('/users/:id', authMiddleware, updateUser);

// @route   PATCH /api/auth/users/:id/status
// @desc    Activate, deactivate, or block user
// @access  Private (Admin/Manager)
router.patch('/users/:id/status', authMiddleware, updateUserStatus);

// @route   POST /api/auth/users/:id/login-as
// @desc    Super admin opens a session as another CRM user (new tab)
// @access  Private (super_admin)
router.post('/users/:id/login-as', authMiddleware, loginAsUser);

// @route   POST /api/auth/users/:id/reset-password
// @desc    Reset user password (admin only)
// @access  Private (Admin)
router.post('/users/:id/reset-password', authMiddleware, resetUserPassword);

// @route   POST /api/auth/users/backfill-remember-pass
// @desc    Match bcrypt hashes to known passwords and store viewable copy (admin)
// @access  Private (Admin)
router.post('/users/backfill-remember-pass', authMiddleware, backfillUserRememberPass);

// @route   PUT /api/auth/users/:id/permissions
// @desc    Update user permissions
// @access  Private (Admin/Manager)
router.put('/users/:id/permissions', authMiddleware, updateUserPermissions);

// @route   DELETE /api/auth/users/:id
// @desc    Soft delete/deactivate user
// @access  Private (manager/admin/superadmin enforced in controller)
router.delete('/users/:id', authMiddleware, deleteUser);

module.exports = router;
