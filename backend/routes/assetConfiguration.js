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
router.get('/cascade/brands', ctrl.listCascadeBrands);
router.get('/cascade/spec-masters', ctrl.listCascadeSpecMasters);
router.get('/cascade/filter-options', ctrl.listInventorySpecFilterOptions);
router.get('/cascade/brands/:brandName/processors', ctrl.listCascadeProcessorsForBrand);
router.get('/cascade/brands/:brandName/models', ctrl.listCascadeModelsForBrand);
router.get('/cascade/brands/:brandName/generations', ctrl.listCascadeGenerationsForBrand);
router.get('/cascade/brands/:brandName/processors/:processorName/generations', ctrl.listCascadeGenerationsForBrandProcessor);
// Read-only spec tree — floor pipeline filters, QC, SO forms (any authenticated user)
router.get('/mappings/laptop-spec/tree', ctrl.getLaptopSpecMapping);

// Settings CRUD meta
router.get('/types', view, ctrl.listEntityTypes);
router.get('/parents/:entity', view, ctrl.getParentOptions);

// Brand flat mapping (models, processors, generations per brand)
router.post('/mappings/laptop-spec/models/bulk-add', create, ctrl.bulkAddBrandModels);
router.post('/mappings/laptop-spec/processors/bulk-add', create, ctrl.bulkAddBrandProcessors);
router.post('/mappings/laptop-spec/generations/bulk-add', create, ctrl.bulkAddBrandGenerations);
router.post('/mappings/laptop-spec/models/bulk-delete', del, ctrl.bulkDeleteBrandModels);
router.post('/mappings/laptop-spec/processors/bulk-delete', del, ctrl.bulkDeleteBrandProcessors);
router.post('/mappings/laptop-spec/generations/bulk-delete', del, ctrl.bulkDeleteBrandGenerations);
router.post('/mappings/laptop-spec/models/bulk-status', edit, ctrl.bulkStatusBrandModels);
router.post('/mappings/laptop-spec/processors/bulk-status', edit, ctrl.bulkStatusBrandProcessors);
router.post('/mappings/laptop-spec/generations/bulk-status', edit, ctrl.bulkStatusBrandGenerations);

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
crudRoutes('spare-brands', ctrl.listSpareBrands, ctrl.getSpareBrand, ctrl.createSpareBrand, ctrl.updateSpareBrand, ctrl.deleteSpareBrand, ctrl.setSpareBrandStatus);
crudRoutes('models', ctrl.listModels, ctrl.getModel, ctrl.createModel, ctrl.updateModel, ctrl.deleteModel, ctrl.setModelStatus);
crudRoutes('processors', ctrl.listProcessors, ctrl.getProcessor, ctrl.createProcessor, ctrl.updateProcessor, ctrl.deleteProcessor, ctrl.setProcessorStatus);
crudRoutes('generations', ctrl.listGenerations, ctrl.getGeneration, ctrl.createGeneration, ctrl.updateGeneration, ctrl.deleteGeneration, ctrl.setGenerationStatus);
crudRoutes('ram', ctrl.listRam, ctrl.getRam, ctrl.createRam, ctrl.updateRam, ctrl.deleteRam, ctrl.setRamStatus);
crudRoutes('storage', ctrl.listStorage, ctrl.getStorage, ctrl.createStorage, ctrl.updateStorage, ctrl.deleteStorage, ctrl.setStorageStatus);
crudRoutes('gpus', ctrl.listGpus, ctrl.getGpu, ctrl.createGpu, ctrl.updateGpu, ctrl.deleteGpu, ctrl.setGpuStatus);
crudRoutes('screen-sizes', ctrl.listScreenSizes, ctrl.getScreenSize, ctrl.createScreenSize, ctrl.updateScreenSize, ctrl.deleteScreenSize, ctrl.setScreenSizeStatus);

module.exports = router;
