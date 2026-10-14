const express = require('express');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const pool = require('../config/db');
const ctrl = require('../controllers/loanLaptopController');

const router = express.Router();
router.use(authMiddleware);
// The JWT carries no display name; the loan history and TTSPL audit record one.
router.use(async (req, res, next) => {
  if (req.user?.user_id && !req.user.name) {
    try {
      const r = await pool.query('SELECT name FROM users WHERE user_id = $1', [req.user.user_id]);
      req.user = { ...req.user, name: r.rows[0]?.name || req.user.email || null };
    } catch (_) { /* name is cosmetic */ }
  }
  next();
});

// Support raises and tracks loans; Accounts approves loans, prices and
// conversions; warehouse / dispatch issue the Loan DC (existing DC grant).
const anyView = checkAnySectionPermission(['loan_laptops', 'loan_laptop_approval'], 'view');
const supportCreate = checkSectionPermission('loan_laptops', 'create');
const supportEdit = checkSectionPermission('loan_laptops', 'edit');
const accountsApprove = checkSectionPermission('loan_laptop_approval', 'edit');
const issueDc = checkSectionPermission('delivery_challans', 'edit');
const policyView = checkAnySectionPermission(['loan_laptop_policy', 'loan_laptops', 'loan_laptop_approval'], 'view');
const policyEdit = checkSectionPermission('loan_laptop_policy', 'edit');
const policyDelete = checkSectionPermission('loan_laptop_policy', 'delete');

router.get('/counts', anyView, ctrl.counts);
router.get('/policy', policyView, ctrl.getPolicy);
router.post('/policy/evaluate', policyView, ctrl.evaluatePolicy);
router.post('/policy/rules', policyEdit, ctrl.createRule);
router.put('/policy/rules/:ruleId', policyEdit, ctrl.updateRule);
router.delete('/policy/rules/:ruleId', policyDelete, ctrl.deleteRule);
router.put('/policy/tiers', policyEdit, ctrl.upsertTier);
router.delete('/policy/tiers/:family', policyDelete, ctrl.deleteTier);

router.get('/ticket/:ticketId/context', supportEdit, ctrl.ticketContext);
router.get('/available-laptops', supportEdit, ctrl.availableLaptops);

router.get('/', anyView, ctrl.list);
router.post('/', supportCreate, ctrl.create);
router.get('/:id', anyView, ctrl.get);
router.post('/:id/approve', accountsApprove, ctrl.approve);
router.post('/:id/reject', accountsApprove, ctrl.reject);
router.post('/:id/loan-dc', issueDc, ctrl.createLoanDc);
router.post('/:id/loan-dc/pdf', anyView, ctrl.regenerateLoanDcPdf);
router.post('/:id/repair-completed', supportEdit, ctrl.repairCompleted);
router.post('/:id/decision', supportEdit, ctrl.decision);
router.post('/:id/approve-conversion', accountsApprove, ctrl.approveConversion);
router.post('/:id/reject-conversion', accountsApprove, ctrl.rejectConversion);
router.post('/:id/cancel', supportEdit, ctrl.cancel);

module.exports = router;
