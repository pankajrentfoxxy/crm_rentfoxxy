const express = require('express');
const { technicianAuth } = require('../middleware/technicianAuth');
const ctrl = require('../controllers/technicianAuthController');

const router = express.Router();

router.post('/login', ctrl.login);
router.get('/me', technicianAuth, ctrl.me);
router.get('/dashboard', technicianAuth, ctrl.dashboard);

module.exports = router;
