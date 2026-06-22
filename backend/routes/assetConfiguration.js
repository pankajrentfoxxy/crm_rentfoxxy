const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/assetConfigurationController');

const cp = checkSectionPermission;
const view = cp('asset_configuration', 'view');
const create = cp('asset_configuration', 'create');
const edit = cp('asset_configuration', 'edit');
const del = cp('asset_configuration', 'delete');

router.use(authMiddleware);

// Used by quotation / SO / DC asset forms — any authenticated user
router.get('/dropdowns', ctrl.getDropdownCatalog);

// Settings CRUD meta
router.get('/types', view, ctrl.listEntityTypes);
router.get('/parents/:entity', view, ctrl.getParentOptions);

// Parent ↔ child mapping (brand-models | processor-generations)
router.get('/mappings/:type', view, ctrl.getMapping);
router.post('/mappings/:type/bulk-create', create, ctrl.bulkCreateMapping);
router.post('/mappings/:type/reassign', edit, ctrl.reassignMapping);
router.post('/mappings/:type/bulk-delete', del, ctrl.bulkDeleteMapping);
router.post('/mappings/:type/bulk-status', edit, ctrl.bulkStatusMapping);

function crudRoutes(path, list, get, post, put, remove, patchStatus) {
  router.get(`/${path}`, view, list);
  router.get(`/${path}/:id`, view, get);
  router.post(`/${path}`, create, post);
  router.put(`/${path}/:id`, edit, put);
  router.delete(`/${path}/:id`, del, remove);
  router.patch(`/${path}/:id/status`, edit, patchStatus);
}

crudRoutes('brands', ctrl.listBrands, ctrl.getBrand, ctrl.createBrand, ctrl.updateBrand, ctrl.deleteBrand, ctrl.setBrandStatus);
crudRoutes('models', ctrl.listModels, ctrl.getModel, ctrl.createModel, ctrl.updateModel, ctrl.deleteModel, ctrl.setModelStatus);
crudRoutes('processors', ctrl.listProcessors, ctrl.getProcessor, ctrl.createProcessor, ctrl.updateProcessor, ctrl.deleteProcessor, ctrl.setProcessorStatus);
crudRoutes('generations', ctrl.listGenerations, ctrl.getGeneration, ctrl.createGeneration, ctrl.updateGeneration, ctrl.deleteGeneration, ctrl.setGenerationStatus);
crudRoutes('ram', ctrl.listRam, ctrl.getRam, ctrl.createRam, ctrl.updateRam, ctrl.deleteRam, ctrl.setRamStatus);
crudRoutes('storage', ctrl.listStorage, ctrl.getStorage, ctrl.createStorage, ctrl.updateStorage, ctrl.deleteStorage, ctrl.setStorageStatus);
crudRoutes('gpus', ctrl.listGpus, ctrl.getGpu, ctrl.createGpu, ctrl.updateGpu, ctrl.deleteGpu, ctrl.setGpuStatus);
crudRoutes('screen-sizes', ctrl.listScreenSizes, ctrl.getScreenSize, ctrl.createScreenSize, ctrl.updateScreenSize, ctrl.deleteScreenSize, ctrl.setScreenSizeStatus);

module.exports = router;
