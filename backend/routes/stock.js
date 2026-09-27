const router = require('express').Router();
const ctrl = require('../controllers/stockController');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');

// Stock screens in the new UI (claude/carret-stock.md). Tag / slot changes are
// the warehouse's (ready_to_rent_location edit); scrap approval is a manager's
// (scrap_approval edit, migration 353).
router.use(authMiddleware);

const invView = checkSectionPermission('inventory_management', 'view');
const readyView = checkAnySectionPermission(['inventory_management', 'ready_to_rent_location'], 'view');
const warehouseEdit = checkSectionPermission('ready_to_rent_location', 'edit');
const scrapRaise = checkAnySectionPermission(['inventory_management', 'floor_tickets', 'qc_management', 'ready_to_rent_location'], 'edit');
const scrapView = checkAnySectionPermission(['inventory_management', 'scrap_approval', 'scrap_challans'], 'view');

router.get('/assets', invView, ctrl.listAssets);
router.get('/assets/counts', invView, ctrl.assetCounts);
router.get('/assets/:id', invView, ctrl.getAsset);
router.get('/ready', readyView, ctrl.readyStock);
router.get('/carrets', readyView, ctrl.carrets);
router.post('/retag', warehouseEdit, ctrl.retag);
router.post('/location', warehouseEdit, ctrl.setLocation);

router.get('/scrap-requests', scrapView, ctrl.listScrapRequests);
router.post('/scrap-requests', scrapRaise, ctrl.requestScrap);
router.post('/scrap-requests/:id/decide', checkSectionPermission('scrap_approval', 'edit'), ctrl.decideScrap);
router.post('/scrap-requests/:id/cancel', scrapRaise, ctrl.cancelScrapRequest);
router.get('/scrap/awaiting-challan', scrapView, ctrl.scrappedAwaitingChallan);

router.get('/not-earning', invView, ctrl.notEarning);

module.exports = router;
