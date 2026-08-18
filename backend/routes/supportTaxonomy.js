'use strict';

const router = require('express').Router();
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/supportTaxonomyController');

const view = checkSectionPermission('support_taxonomy', 'view');
const lookup = checkAnySectionPermission(['support_taxonomy', 'support_tickets'], 'view');
const create = checkSectionPermission('support_taxonomy', 'create');
const edit = checkSectionPermission('support_taxonomy', 'edit');
const del = checkSectionPermission('support_taxonomy', 'delete');

router.use(authMiddleware);

router.get('/catalog/search', lookup, ctrl.searchCatalog);
router.get('/catalog/tree', lookup, ctrl.catalogTree);
router.get('/catalog/:id/stats', view, ctrl.catalogStats);
router.get('/catalog', lookup, ctrl.listCatalog);
router.post('/catalog', create, ctrl.createCatalog);
router.patch('/catalog/:id', edit, ctrl.patchCatalog);
router.delete('/catalog/:id', del, ctrl.deleteCatalog);
router.get('/resolution-codes', lookup, ctrl.listResolutionCodes);
router.get('/root-causes', lookup, ctrl.listRootCauses);
router.get('/action-codes', lookup, ctrl.listActionCodes);

module.exports = router;
