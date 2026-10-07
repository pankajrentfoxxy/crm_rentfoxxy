const express = require('express');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const { contactFileUpload } = require('../config/whatsappCampaignUpload');
const ctrl = require('../controllers/whatsappCampaignController');

const router = express.Router();
const cp = checkSectionPermission;

// Public, token-checked: Interakt delivery / read receipts. Must stay above authMiddleware.
router.post('/webhooks/interakt', ctrl.interaktWebhook);

router.use(authMiddleware);

router.get('/config', cp('whatsapp_campaigns', 'view'), ctrl.getConfig);
router.get('/', cp('whatsapp_campaigns', 'view'), ctrl.listCampaigns);
router.post('/', cp('whatsapp_campaigns', 'create'), ctrl.createCampaign);
router.get('/:id', cp('whatsapp_campaigns', 'view'), ctrl.getCampaign);
router.put('/:id', cp('whatsapp_campaigns', 'edit'), ctrl.updateCampaign);
router.delete('/:id', cp('whatsapp_campaigns', 'delete'), ctrl.deleteCampaign);
router.post('/:id/import', cp('whatsapp_campaigns', 'create'), contactFileUpload, ctrl.importContacts);
router.get('/:id/imports', cp('whatsapp_campaigns', 'view'), ctrl.listImports);
router.get('/:id/contacts/export', cp('whatsapp_campaigns', 'view'), ctrl.exportContacts);
router.get('/:id/contacts', cp('whatsapp_campaigns', 'view'), ctrl.listContacts);
router.get('/:id/stats', cp('whatsapp_campaigns', 'view'), ctrl.getStats);
// Granular send controls (separate sections, granted with Edit — like dispatch_charger_reset).
router.post('/:id/start', cp('whatsapp_campaigns_start', 'edit'), ctrl.startCampaign);
router.post('/:id/resume', cp('whatsapp_campaigns_start', 'edit'), ctrl.resumeCampaign);
router.post('/:id/pause', cp('whatsapp_campaigns_pause', 'edit'), ctrl.pauseCampaign);
router.post('/:id/cancel', cp('whatsapp_campaigns_cancel', 'edit'), ctrl.cancelCampaign);

module.exports = router;
