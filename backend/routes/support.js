const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { multerLimits, wrapMulter, multerErrorMessage, UPLOAD_MAX_FILE_MB } = require('../config/uploadLimits');
const { authMiddleware } = require('../middleware/auth');
const { requireSupportAccess, requireSupportLead, requireSupportTicketClose, requireSupportTicketCancel } = require('../middleware/supportAccess');
const {
    listCategories,
    listTechnicians,
    searchCustomers,
    getCustomerDetail,
    getCustomerAssets,
    listTickets,
    countTickets,
    getDashboard,
    getNavBadges,
    createTicket,
    getTicket,
    closeTicket,
    cancelTicket,
    addComment,
    markWorkDone,
    uploadPod,
    removePod,
    verifyOtp,
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
    verifyTtspl,
    submitForPickup,
    warehouseReceivedPickup,
    createPickupWithReturnDc,
    createPickupTicket,
    getPickupDeliveryContext,
    technicianSignPickup,
    verifyPickupCustomerOtp,
    confirmWarehouseReceipt,
    getTechnicianLaptopBucket,
    setOutcome,
    markPickedUp,
    initiateReplacement,
    cancelReturnPickup,
    getReplacementContext,
    assignReturnPickupDispatch,
    changeReturnPickupAssignment,
    moveComplaintToReplacement,
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

const MIME_EXT = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/gif': 'gif',
    'application/pdf': 'pdf'
};

const supportStorage = multer.diskStorage({
    destination: supportUploadDir,
    filename: (req, file, cb) => {
        const ext = (path.extname(file.originalname || '').replace('.', '').toLowerCase())
            || MIME_EXT[file.mimetype]
            || 'jpg';
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `pod-${unique}.${ext}`);
    }
});

const upload = multer({
    storage: supportStorage,
    limits: multerLimits(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype && (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf')) {
            return cb(null, true);
        }
        return cb(new Error('Only image or PDF files are allowed'));
    }
});

// Wrap multer so its errors (size limit, file type) come back as JSON instead of
// an unhandled 500 — otherwise the client just shows a generic "Action failed".
const uploadPodFile = (req, res, next) => {
    upload.single('pod')(req, res, (err) => {
        if (err) {
            const message = err.code === 'LIMIT_FILE_SIZE'
                ? `Image is too large. Please keep it under ${UPLOAD_MAX_FILE_MB} MB.`
                : multerErrorMessage(err);
            return res.status(400).json({ success: false, message });
        }
        return next();
    });
};

router.use(authMiddleware);

// Warehouse receipt confirmation must be reachable by the warehouse / manager
// roles too (they are not "support" roles), so it is registered before the
// support-access gate. The controller enforces the allowed roles itself.
router.post('/items/:itemId/warehouse-confirm', confirmWarehouseReceipt);

router.use(requireSupportAccess);

router.get('/categories', listCategories);
router.get('/technicians', listTechnicians);
router.get('/customers', searchCustomers);
router.get('/customers/:customerId', getCustomerDetail);
router.get('/customers/:customerId/assets', getCustomerAssets);
router.get('/customers/:customerId/pickup-context', getPickupDeliveryContext);
router.get('/dashboard', getDashboard);
router.get('/badges', getNavBadges);
router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.post('/categories', upsertCategory);
router.delete('/categories/:categoryId', deleteCategory);
router.get('/tickets', listTickets);
router.get('/tickets/counts', countTickets);
router.get('/tickets/export', exportTickets);
router.get('/tickets/check-duplicate', checkDuplicateTicket);
router.post('/tickets/pickup-ticket', requireSupportLead, createPickupTicket);
router.post('/tickets', createTicket);
router.get('/tickets/:ticketId', getTicket);
router.patch('/tickets/:ticketId', requireSupportLead, updateTicket);
router.post('/tickets/:ticketId/phases', requireSupportLead, addWorkflowPhaseItems);
router.post('/tickets/:ticketId/assign-all', requireSupportLead, assignTicketBulk);
router.post('/tickets/:ticketId/close', requireSupportTicketClose, closeTicket);
router.post('/tickets/:ticketId/cancel', requireSupportTicketCancel, cancelTicket);
router.post('/tickets/:ticketId/replacements', requireSupportLead, initiateReplacement);
router.post('/tickets/:ticketId/cancel-return-pickup', requireSupportLead, cancelReturnPickup);
router.post('/tickets/:ticketId/assign-return-pickup', requireSupportLead, assignReturnPickupDispatch);
router.patch('/tickets/:ticketId/return-pickup-assignment', requireSupportLead, changeReturnPickupAssignment);
router.get('/tickets/:ticketId/replacement-context', requireSupportLead, getReplacementContext);
router.post('/items/:itemId/move-to-replacement', requireSupportLead, moveComplaintToReplacement);
router.get('/customers/:customerId/available-assets', getAvailableAssets);
router.post('/items/:itemId/comments', addComment);
router.post('/items/:itemId/work-done', markWorkDone);
router.post('/items/:itemId/visit', logVisit);
router.post('/items/:itemId/mark-visited', markVisited);
router.post('/items/:itemId/verify-ttspl', verifyTtspl);
router.post('/items/:itemId/submit-pickup', submitForPickup);
router.post('/items/:itemId/warehouse-received', requireSupportLead, warehouseReceivedPickup);
router.post('/items/:itemId/set-outcome', setOutcome);
router.post('/items/:itemId/picked-up', markPickedUp);
router.delete('/items/:itemId', requireSupportLead, removeTicketItem);
router.post('/items/:itemId/pod', uploadPodFile, uploadPod);
router.delete('/items/:itemId/pod', removePod);
router.post('/items/:itemId/verify-otp', verifyOtp);
router.post('/items/:itemId/verify-customer-otp', verifyOtp);
router.post('/items/:itemId/verify-warehouse-otp', verifyOtp);
router.patch('/items/:itemId/assign', requireSupportLead, assignItem);

// Phase 20 — pickup flow redesign
router.post('/tickets/:ticketId/pickup', requireSupportLead, createPickupWithReturnDc);
router.post('/items/:itemId/pickup-reached', logVisit);
router.post('/items/:itemId/technician-esign', technicianSignPickup);
router.post('/items/:itemId/verify-pickup-otp', verifyPickupCustomerOtp);
router.get('/tech-bucket/laptops', getTechnicianLaptopBucket);

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
