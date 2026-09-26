const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const { vrdcRoute } = require('../middleware/dcNumberRoutes');
const { multerLimits, wrapMulter } = require('../config/uploadLimits');
const ctrl = require('../controllers/vendorRepairController');

const vrdcEwayStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const safeDc = String(req.params.dcNumber || 'dc').replace(/[^\w-]+/g, '_');
    const dir = path.join(__dirname, '../uploads/vrdc-eway', safeDc);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `eway_${Date.now()}${ext}`);
  },
});
const uploadVrdcEwayDoc = multer({
  storage: vrdcEwayStorage,
  limits: multerLimits({ files: 1 }),
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf)$/i.test(file.mimetype);
    if (!ok) return cb(new Error('Only PDF or image files allowed'));
    cb(null, true);
  },
});

const invView = checkSectionPermission('inventory_management', 'view');
/** Laptop Vendor Repair DC list/detail/PDF — dedicated RBAC (+ legacy floor viewers). */
const vendorRepairView = checkAnySectionPermission(
  ['vendor_repair_dc', 'vendor_repair_dc_dispatch', 'floor_pipeline', 'vendor_management'],
  'view'
);
const diagnosisFailedView = checkAnySectionPermission(
  ['diagnosis_failed', 'floor_pipeline'],
  'view'
);

router.use(authMiddleware);

router.get('/company-defaults', checkAnySectionPermission(['vendor_repair_dc', 'floor_pipeline', 'diagnosis_failed'], 'view'), ctrl.getCompanyDefaults);
router.get('/dc', vendorRepairView, ctrl.listVendorRepairDcs);
router.get('/diagnosis-failed', diagnosisFailedView, ctrl.listDiagnosisFailed);
router.get('/inventory', invView, ctrl.listOutForRepairInventory);
router.get('/inventory/count', invView, ctrl.getOutForRepairInventoryCount);
router.get('/inventory/export.xlsx', invView, ctrl.exportOutForRepairExcel);
router.get('/inventory/export.pdf', invView, ctrl.exportOutForRepairPdf);

router.post('/out-for-repair', ctrl.requireDiagnosisFailedProcess, ctrl.createOutForRepair);
router.get(...vrdcRoute('/pdf', vendorRepairView, ctrl.downloadPdf));
router.get(...vrdcRoute('/receive-pdf', vendorRepairView, ctrl.downloadReceivePdf));
router.patch(...vrdcRoute('/dispatch-details', ctrl.requireVendorRepairDispatch, ctrl.updateDispatchDetails));
router.patch(...vrdcRoute('/commercial-details', ctrl.requireWarehouse, ctrl.updateCommercialDetails));
router.post(...vrdcRoute('/mark-delivered-to-vendor', ctrl.requireVendorRepairDispatch, ctrl.markDeliveredToVendor));
router.post(...vrdcRoute('/dispatch-sign', ctrl.requireVendorRepairDispatch, ctrl.signDispatch));
router.post(...vrdcRoute('/cancel', ctrl.requireVendorRepairDispatch, ctrl.cancelDc));
router.post(...vrdcRoute('/receive-back', ctrl.requireWarehouse, ctrl.receiveBack));
router.post(...vrdcRoute('/send-accounts-eway-mail', vendorRepairView, ctrl.sendAccountsVrdcEwayMail));
router.post(...vrdcRoute('/vrdc-eway', ctrl.requireVrdcEwayUpload, wrapMulter(uploadVrdcEwayDoc.single('eway_bill_pdf')), ctrl.uploadVrdcEway));
// Repair request, rent pause, replacement, vendor keeps it (claude/carret-vendor-repair.md)
// Accounts / the named approver may not hold the repair sections — they still see what waits for them.
const approverOrRepairView = (req, res, next) => (
  require('../services/vendorRepairRentService').canApproveReplacement(req.user) ? next() : vendorRepairView(req, res, next)
);
router.get('/replacement-approvals', approverOrRepairView, ctrl.listReplacementApprovals);
const rentalAssetsView = checkAnySectionPermission(['vendor_management', 'vendor_billing_mgmt', 'vendor_repair_dc'], 'view');
router.get('/rental-assets', rentalAssetsView, ctrl.vendorRentalSummary);
router.get('/rental-assets/laptops', rentalAssetsView, ctrl.vendorRentalLaptops);
router.get(...vrdcRoute('/repair-mail/preview', vendorRepairView, ctrl.previewRepairMail));
router.post(...vrdcRoute('/repair-mail', ctrl.requireVendorRepairDispatch, ctrl.sendRepairMail));
router.get(...vrdcRoute('/repair-request-pdf', vendorRepairView, ctrl.downloadRepairRequestPdf));
router.patch(...vrdcRoute('/request-details', ctrl.requireVendorRepairDispatch, ctrl.updateRequestDetails));
router.post(...vrdcRoute('/replacement-check', ctrl.requireWarehouse, ctrl.startReplacementCheck));
router.post(...vrdcRoute('/replacement-decision', ctrl.requireReplacementApprover, ctrl.decideReplacement));
router.post(...vrdcRoute('/vendor-kept/preview', ctrl.requireWarehouse, ctrl.previewVendorKept));
router.post(...vrdcRoute('/vendor-kept', ctrl.requireWarehouse, ctrl.markVendorKept));
router.get(...vrdcRoute('', vendorRepairView, ctrl.getVendorRepairDc));

router.post('/inventory/erp/:serialId/receive-back', ctrl.requireWarehouse, ctrl.receiveErpRepairBack);

module.exports = router;
