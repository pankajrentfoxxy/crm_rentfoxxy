'use strict';

const router = require('express').Router();
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/supportSlaController');

const view = checkSectionPermission('support_sla_admin', 'view');
const create = checkSectionPermission('support_sla_admin', 'create');
const edit = checkSectionPermission('support_sla_admin', 'edit');
const preview = checkAnySectionPermission(['support_sla_admin', 'support_tickets'], 'view');

router.use(authMiddleware);

router.get('/policies', view, ctrl.listPolicies);
router.post('/policies', create, ctrl.createPolicy);
router.patch('/policies/:id', edit, ctrl.patchPolicy);
router.get('/calendars', view, ctrl.listCalendars);
router.post('/calendars/:id/holidays', edit, ctrl.addHoliday);
router.post('/preview', preview, ctrl.preview);
router.get('/breaches', view, ctrl.breaches);

module.exports = router;
