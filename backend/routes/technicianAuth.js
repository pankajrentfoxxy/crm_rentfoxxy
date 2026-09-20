const express = require('express');
const { technicianAuth } = require('../middleware/technicianAuth');
const ctrl = require('../controllers/technicianAuthController');
const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/login', loginLimiter, ctrl.login);
router.get('/me', technicianAuth, ctrl.me);
router.get('/dashboard', technicianAuth, ctrl.dashboard);

module.exports = router;
