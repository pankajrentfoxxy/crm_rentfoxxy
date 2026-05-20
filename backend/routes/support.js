const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const { requireSupportAccess, requireSupportLead } = require('../middleware/supportAccess');
const {
    listCategories,
    listTechnicians,
    searchCustomers,
    getCustomerDetail,
    getCustomerAssets,
    listTickets,
    getDashboard,
    getNavBadges,
    createTicket,
    getTicket,
    closeTicket,
    addComment,
    markWorkDone,
    uploadPod,
    removePod,
    verifyOtp,
    logLoanMachine,
    schedulePickup,
    assignItem,
    getSettings,
    updateSettings,
    upsertCategory,
    deleteCategory,
    checkDuplicateTicket,
    addWorkflowPhaseItems,
    assignTicketBulk,
    updateTicket,
    logVisit,
    markVisited,
    setOutcome,
    markPickedUp,
    initiateReplacement,
    updateReplacementOrder,
    deliverReplacement,
    exportTickets,
    getAvailableAssets,
    removeTicketItem,
    ensureSupportSchema
} = require('../controllers/supportController');

const router = express.Router();

const supportUploadDir = path.join(__dirname, '..', 'uploads', 'support');
if (!fs.existsSync(supportUploadDir)) {
    fs.mkdirSync(supportUploadDir, { recursive: true });
}

const upload = multer({
    dest: supportUploadDir,
    limits: { fileSize: 8 * 1024 * 1024 }
});

router.use(authMiddleware);
router.use(requireSupportAccess);

router.get('/categories', listCategories);
router.get('/technicians', listTechnicians);
router.get('/customers', searchCustomers);
router.get('/customers/:customerId', getCustomerDetail);
router.get('/customers/:customerId/assets', getCustomerAssets);
router.get('/dashboard', getDashboard);
router.get('/badges', getNavBadges);
router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.post('/categories', upsertCategory);
router.delete('/categories/:categoryId', deleteCategory);
router.get('/tickets', listTickets);
router.get('/tickets/export', exportTickets);
router.get('/tickets/check-duplicate', checkDuplicateTicket);
router.post('/tickets', createTicket);
router.get('/tickets/:ticketId', getTicket);
router.patch('/tickets/:ticketId', requireSupportLead, updateTicket);
router.post('/tickets/:ticketId/phases', requireSupportLead, addWorkflowPhaseItems);
router.post('/tickets/:ticketId/assign-all', requireSupportLead, assignTicketBulk);
router.post('/tickets/:ticketId/close', requireSupportLead, closeTicket);
router.post('/tickets/:ticketId/replacements', requireSupportLead, initiateReplacement);
router.get('/customers/:customerId/available-assets', getAvailableAssets);
router.post('/items/:itemId/comments', addComment);
router.post('/items/:itemId/work-done', markWorkDone);
router.post('/items/:itemId/visit', logVisit);
router.post('/items/:itemId/mark-visited', markVisited);
router.post('/items/:itemId/set-outcome', setOutcome);
router.post('/items/:itemId/picked-up', markPickedUp);
router.delete('/items/:itemId', requireSupportLead, removeTicketItem);
router.post('/items/:itemId/pod', upload.single('pod'), uploadPod);
router.delete('/items/:itemId/pod', removePod);
router.post('/items/:itemId/verify-otp', verifyOtp);
router.post('/items/:itemId/verify-customer-otp', verifyOtp);
router.post('/items/:itemId/verify-warehouse-otp', verifyOtp);
router.patch('/items/:itemId/assign', requireSupportLead, assignItem);
router.post('/items/:itemId/loan-machine', logLoanMachine);
router.post('/items/:itemId/schedule-pickup', schedulePickup);
router.patch('/replacement-orders/:orderId', requireSupportLead, updateReplacementOrder);
router.post('/replacement-orders/:orderId/deliver', requireSupportLead, deliverReplacement);

router.post('/admin/ensure-schema', requireSupportLead, async (req, res) => {
    try {
        await ensureSupportSchema();
        res.json({ success: true, message: 'Support schema ensured' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
