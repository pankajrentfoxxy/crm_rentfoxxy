const router = require('express').Router();
const ctrl = require('../controllers/lockInBreakController');
const { authMiddleware, checkAnySectionPermission, checkSectionPermission } = require('../middleware/auth');

// Early return before lock-in ends: Support raises, Sales proposes, Accounts decide.
const SO_SECTIONS = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement'];

router.use(authMiddleware);

router.get('/', checkAnySectionPermission(['support_tickets', 'customer_billing', ...SO_SECTIONS], 'view'), ctrl.list);
router.post('/', checkSectionPermission('support_tickets', 'create'), ctrl.create);
router.post('/:id/propose', checkAnySectionPermission(SO_SECTIONS, 'edit'), ctrl.propose);
router.post('/:id/decide', checkSectionPermission('customer_billing', 'edit'), ctrl.decide);
router.post('/:id/cancel', checkAnySectionPermission(['support_tickets', 'customer_billing', ...SO_SECTIONS], 'edit'), ctrl.cancel);

module.exports = router;
