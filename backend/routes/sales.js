const express = require('express');
const router = express.Router();
const multer = require('multer');
const { multerLimits } = require('../config/uploadLimits');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');
const customerScope = require('../middleware/customerScope');
const {
    // researchCompanyData,
    createCustomer,
    getCustomers,
    getCustomerById,
    updateCustomer,
    updateCustomerAddress,
    addCustomerAddress,
    uploadCustomersCsv,
    createOrder,
    getOrders,
    getOrderStats,
    getOrderDetails,
    getPipelineLaptops,
    dispatchOrder,
    sendToQC,
    qcPassOrder,
    qcPassOrderItem,
    qcPassOrderItemSubmit,
    qcReplaceOrderItem,
    qcSendItemToProcurement,
    markDelivered,
    generateInvoice,
    generateEwayBill,
    addQCNote,
    downloadInvoicePdf,
    downloadEwayPdf,
    cancelOrder,
    updateOrderItemPrice,
    updateOrderCharges,
    updateOrderItemLogistics,
    updateOrderItemTracking,
    getQcPipelineOrders,
    getDispatchPipelineOrders,
    exportOrdersCsv
} = require('../controllers/salesController');

// CT1 (27 Sep 2026): each gate keeps its role / legacy permissions[] check and
// ALSO accepts the matching Roles & Permissions grant (legacyOrSection).
const { legacyOrSection, hasLegacyPermission } = require('../middleware/legacyOrSection');
const isRole = (u, ...roles) => roles.includes(u.role);

// Admin-only middleware
const requireAdmin = legacyOrSection(
    (u) => isRole(u, 'admin'),
    'customers', 'delete',
    { message: 'Access denied: Admin only' },
);

// Sales access middleware (legacy orders)
const requireSalesAccess = legacyOrSection(
    (u) => isRole(u, 'admin', 'manager') || hasLegacyPermission(u, 'sales_access'),
    'lead_orders', 'edit',
    { message: 'Access denied: Sales access required' },
);

// Warehouse access middleware
const requireWarehouseAccess = legacyOrSection(
    (u) => isRole(u, 'admin', 'manager', 'floor_manager') || hasLegacyPermission(u, 'warehouse_access'),
    'warehouse', 'edit',
    { message: 'Access denied: Warehouse access required' },
);

// QC access middleware
const requireQCAccess = legacyOrSection(
    (u) => isRole(u, 'admin', 'manager', 'floor_manager', 'qc') || hasLegacyPermission(u, 'qc_access'),
    'qc_management', 'edit',
    { message: 'Access denied: QC access required' },
);

// Customers view: admin or customers_access
const requireCustomersAccess = legacyOrSection(
    (u) => isRole(u, 'admin') || hasLegacyPermission(u, 'customers_access'),
    'customers', 'view',
    { message: 'Access denied: Customers access required' },
);

// Customers edit profile (name, GST, company): admin, manager, sales, or customers_edit/sales_access
const requireCustomersEdit = legacyOrSection(
    (u) => isRole(u, 'admin', 'manager', 'sales') || hasLegacyPermission(u, 'customers_edit', 'sales_access'),
    'customers', 'edit',
    { message: 'Access denied: Customers edit permission required' },
);

// Address add/update: admin, customers_edit, or sales_access
const requireAddressAccess = legacyOrSection(
    (u) => isRole(u, 'admin') || hasLegacyPermission(u, 'customers_edit', 'sales_access'),
    'customers', 'edit',
    { message: 'Access denied' },
);

// Dispatch access middleware. Sales stays view-only here whatever it is granted.
const dispatchGate = legacyOrSection(
    (u) => isRole(u, 'admin', 'manager', 'floor_manager', 'dispatch') || hasLegacyPermission(u, 'dispatch_access'),
    'dispatch', 'edit',
    { message: 'Access denied: Dispatch access required' },
);
const requireDispatchAccess = (req, res, next) => {
    if (req.user.role === 'sales') {
        return res.status(403).json({ message: 'Access denied: Sales team is view-only for dispatch workflow' });
    }
    return dispatchGate(req, res, next);
};

// router.post('/research', authMiddleware, requireSalesAccess, researchCompanyData);

const customerUploadDir = 'uploads/customers';
if (!fs.existsSync(customerUploadDir)) fs.mkdirSync(customerUploadDir, { recursive: true });
// See routes/leads.js — uploads/customers is publicly served, so an unfiltered
// upload here is stored XSS on our own origin.
const upload = multer({
    dest: customerUploadDir,
    limits: multerLimits(),
    fileFilter: (_req, file, cb) => {
        const mime = String(file.mimetype || '').toLowerCase();
        const ext = require('path').extname(file.originalname || '').toLowerCase();
        if (['.html', '.htm', '.svg', '.js', '.mjs', '.xhtml', '.php'].includes(ext)) {
            return cb(new Error('This file type is not allowed'));
        }
        const allowed = [
            'text/csv', 'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/pdf',
        ];
        if (allowed.includes(mime) || mime.startsWith('image/')) return cb(null, true);
        return cb(new Error('Only CSV, Excel, PDF or image files are allowed'));
    },
});

router.post('/customers', authMiddleware, legacyOrSection(
    (u) => isRole(u, 'admin', 'manager', 'sales') || hasLegacyPermission(u, 'sales_access', 'customers_edit'),
    'customers', 'create',
    { message: 'Access denied' },
), createCustomer);
router.post('/customers/upload', authMiddleware, legacyOrSection(
    (u) => isRole(u, 'admin'),
    'customers', 'create',
    { message: 'Admin only' },
), upload.single('file'), uploadCustomersCsv);
const requireCustomersOrSalesAccess = legacyOrSection(
    (u) => isRole(u, 'admin', 'manager', 'sales') || hasLegacyPermission(u, 'sales_access', 'customers_access'),
    'customers', 'view',
    { message: 'Access denied' },
);
router.get('/customers', authMiddleware, requireCustomersOrSalesAccess, customerScope, getCustomers);
router.get('/customers/:id', authMiddleware, requireCustomersOrSalesAccess, customerScope, getCustomerById);
router.put('/customers/:id', authMiddleware, requireCustomersEdit, customerScope, updateCustomer);
router.put('/customers/:id/addresses/:addr_id', authMiddleware, requireAddressAccess, customerScope, updateCustomerAddress);
router.post('/customers/:id/addresses', authMiddleware, requireAddressAccess, customerScope, addCustomerAddress);
router.post('/orders', authMiddleware, requireSalesAccess, createOrder);
router.get('/orders', authMiddleware, getOrders); // All logged-in users can fetch orders (filtered by role)
router.get('/orders/export-csv', authMiddleware, exportOrdersCsv);
router.get('/qc-pipeline-orders', authMiddleware, getQcPipelineOrders);
router.get('/dispatch-pipeline-orders', authMiddleware, getDispatchPipelineOrders);
router.get('/orders/stats', authMiddleware, getOrderStats);
router.get('/orders/pipeline-laptops', authMiddleware, requireDispatchAccess, getPipelineLaptops);
router.get('/orders/:id', authMiddleware, getOrderDetails);
router.put('/orders/:id/cancel', authMiddleware, requireSalesAccess, cancelOrder);
router.put('/orders/:id/dispatch', authMiddleware, requireDispatchAccess, dispatchOrder);
router.put('/orders/:id/items/:item_id/price', authMiddleware, requireSalesAccess, updateOrderItemPrice);
router.put('/orders/:id/charges', authMiddleware, requireSalesAccess, updateOrderCharges);
router.put('/orders/:id/items/:item_id/logistics', authMiddleware, requireSalesAccess, updateOrderItemLogistics);
router.put('/orders/:id/items/:item_id/tracking', authMiddleware, requireDispatchAccess, updateOrderItemTracking);
router.put('/orders/:id/send-to-qc', authMiddleware, requireDispatchAccess, sendToQC);
router.put('/orders/:id/qc-pass', authMiddleware, requireQCAccess, qcPassOrder);
router.put('/orders/:id/items/:item_id/qc-pass', authMiddleware, requireQCAccess, qcPassOrderItem);
router.post('/orders/:id/items/:item_id/qc-pass-submit', authMiddleware, requireQCAccess, qcPassOrderItemSubmit);
router.post('/orders/:id/items/:item_id/qc-replace', authMiddleware, requireQCAccess, qcReplaceOrderItem);
router.post('/orders/:id/items/:item_id/send-to-procurement', authMiddleware, requireQCAccess, qcSendItemToProcurement);
router.put('/orders/:id/delivered', authMiddleware, requireDispatchAccess, markDelivered);
router.post('/orders/:id/qc-note', authMiddleware, requireQCAccess, addQCNote);
router.post('/orders/:id/generate-invoice', authMiddleware, requireDispatchAccess, generateInvoice);
router.post('/orders/:id/generate-eway', authMiddleware, requireDispatchAccess, generateEwayBill);
router.get('/orders/:id/invoice-pdf', authMiddleware, requireDispatchAccess, downloadInvoicePdf);
router.get('/orders/:id/eway-pdf', authMiddleware, requireDispatchAccess, downloadEwayPdf);

module.exports = router;

