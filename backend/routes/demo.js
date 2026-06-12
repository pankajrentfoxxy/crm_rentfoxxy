const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/demoController');

const cp = checkSectionPermission;

router.use(authMiddleware);

router.get('/agreements', cp('demo_management', 'view'), ctrl.listDemoAgreements);
router.post('/agreements/:demoId/decide', cp('demo_management', 'edit'), ctrl.decideDemo);

module.exports = router;
