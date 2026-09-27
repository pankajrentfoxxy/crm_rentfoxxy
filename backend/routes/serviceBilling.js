const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = require('express').Router();
const ctrl = require('../controllers/serviceBillingController');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const { multerLimits, wrapMulter } = require('../config/uploadLimits');

// Out-of-warranty service on sold (gorefurbo) laptops. Support adds charges on
// the ticket; Accounts (customer_billing) approve, raise the SVO and attach the
// Zoho invoice. Invoices go to private-uploads/ (never the public uploads/).
const invoiceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../private-uploads/service-order-invoices', String(Number(req.params.id) || 0));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `invoice_${Date.now()}${path.extname(file.originalname) || '.pdf'}`),
  }),
  limits: multerLimits({ files: 1 }),
  fileFilter: (req, file, cb) => {
    if (!/^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/i.test(file.mimetype)) return cb(new Error('Only PDF or image files allowed'));
    return cb(null, true);
  },
});

router.use(authMiddleware);

const supportView = checkAnySectionPermission(['support_tickets', 'customer_billing'], 'view');
router.get('/tickets/:ticketId/charges', supportView, ctrl.listTicketCharges);
router.post('/tickets/:ticketId/charges', checkSectionPermission('support_tickets', 'edit'), ctrl.addTicketCharge);
router.delete('/charges/:id', checkSectionPermission('support_tickets', 'edit'), ctrl.removeTicketCharge);

router.get('/charges', checkSectionPermission('customer_billing', 'view'), ctrl.listCharges);
router.post('/charges/:id/decide', checkSectionPermission('customer_billing', 'edit'), ctrl.decideCharge);
router.get('/orders', checkSectionPermission('customer_billing', 'view'), ctrl.listOrders);
router.post('/orders', checkSectionPermission('customer_billing', 'create'), ctrl.raiseOrder);
router.post('/orders/:id/invoice', checkSectionPermission('customer_billing', 'edit'), wrapMulter(invoiceUpload.single('invoice_pdf')), ctrl.attachInvoice);
router.get('/orders/:id/invoice', checkSectionPermission('customer_billing', 'view'), ctrl.downloadInvoice);
router.post('/orders/:id/cancel', checkSectionPermission('customer_billing', 'edit'), ctrl.cancelOrder);

module.exports = router;
