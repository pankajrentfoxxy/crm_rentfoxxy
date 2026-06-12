const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const leadController = require('../controllers/leadController');

// RBAC via the role_permissions matrix (section 'leads').
const cp = checkSectionPermission;
const leadsView = cp('leads', 'view');
const leadsCreate = cp('leads', 'create');
const leadsEdit = cp('leads', 'edit');
const leadsDelete = cp('leads', 'delete');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/leads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `leads-${suffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

router.use(authMiddleware);

router.get('/export-csv', leadsView, leadController.exportLeadsCsv);
router.get('/stages', leadsView, leadController.getLeadStages);
router.get('/', leadsView, leadController.getLeads);
router.get('/follow-ups', leadsView, leadController.getFollowUps);
router.get('/orders', leadsView, leadController.getLeadOrders);
router.get('/reports', leadsView, leadController.getReports);
router.get('/auto-assign-config', leadsView, leadController.getAutoAssignConfig);
router.get('/sample', leadsView, leadController.getSampleCsv);
router.get('/:id', leadsView, leadController.getLeadById);

router.post('/', leadsCreate, leadController.createLead);
router.post('/upload', leadsCreate, upload.single('file'), leadController.uploadLeadsCsv);
router.post('/assign', leadsEdit, leadController.assignLeads);
router.post('/:id/research', leadsEdit, leadController.runResearch);
router.post('/:id/send-quotation', leadsEdit, leadController.sendLeadQuotation);
router.post('/:id/orders', leadsCreate, leadController.createLeadOrder);
router.put('/:id/research', leadsEdit, leadController.updateResearchDetails);
router.get('/:id/addresses', leadsView, leadController.getLeadAddresses);
router.post('/:id/addresses', leadsEdit, leadController.addLeadAddress);
router.delete('/:id/addresses/:address_id', leadsEdit, leadController.deleteLeadAddress);
router.post('/:id/remarks', leadsEdit, leadController.addLeadRemark);
router.delete('/:id/remarks/:remark_id', leadsEdit, leadController.deleteLeadRemark);
router.get('/:id/customer-profile', leadsView, leadController.getLeadCustomerProfile);

router.put('/:id/status', leadsEdit, leadController.updateLeadStatus);
router.put('/:id/follow-up', leadsEdit, leadController.updateFollowUp);
router.put('/:id/basic', leadsEdit, leadController.updateLeadBasicDetails);
router.put('/:id/profile', leadsEdit, leadController.updateLeadFullProfile);
router.post('/:id/convert', cp('lead_conversion', 'create'), leadController.convertToCustomer);
router.get('/:id/conversion', leadsView, leadController.getLeadConversionStatus);

module.exports = router;
