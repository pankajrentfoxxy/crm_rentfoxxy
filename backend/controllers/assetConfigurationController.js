const {
  ENTITIES,
  listEntity,
  getEntityById,
  createEntity,
  updateEntity,
  softDeleteEntity,
  setEntityStatus,
  getAssetCatalogForApi,
  listParentOptions,
} = require('../services/assetConfigurationService');

function entityHandler(entityKey) {
  return {
    list: async (req, res) => {
      try {
        const data = await listEntity(entityKey, {
          page: parseInt(req.query.page, 10) || 1,
          limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
          search: req.query.search || '',
          status: req.query.status || '',
          parentId: req.query.brand_id || req.query.processor_id || null,
          includeInactive: req.query.active_only !== 'true',
        });
        res.json({ success: true, ...data });
      } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message });
      }
    },

    get: async (req, res) => {
      try {
        const row = await getEntityById(entityKey, parseInt(req.params.id, 10));
        if (!row) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, item: row });
      } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message });
      }
    },

    create: async (req, res) => {
      try {
        const row = await createEntity(entityKey, req.body, req.user.user_id);
        res.status(201).json({ success: true, item: row });
      } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message });
      }
    },

    update: async (req, res) => {
      try {
        const row = await updateEntity(entityKey, parseInt(req.params.id, 10), req.body, req.user.user_id);
        res.json({ success: true, item: row });
      } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message });
      }
    },

    remove: async (req, res) => {
      try {
        await softDeleteEntity(entityKey, parseInt(req.params.id, 10), req.user.user_id);
        res.json({ success: true, message: 'Deleted' });
      } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message });
      }
    },

    setStatus: async (req, res) => {
      try {
        const row = await setEntityStatus(
          entityKey,
          parseInt(req.params.id, 10),
          req.body.status,
          req.user.user_id
        );
        res.json({ success: true, item: row });
      } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message });
      }
    },
  };
}

const handlers = Object.fromEntries(
  Object.keys(ENTITIES).map((key) => [key, entityHandler(key)])
);

exports.listBrands = handlers.brands.list;
exports.getBrand = handlers.brands.get;
exports.createBrand = handlers.brands.create;
exports.updateBrand = handlers.brands.update;
exports.deleteBrand = handlers.brands.remove;
exports.setBrandStatus = handlers.brands.setStatus;

exports.listModels = handlers.models.list;
exports.getModel = handlers.models.get;
exports.createModel = handlers.models.create;
exports.updateModel = handlers.models.update;
exports.deleteModel = handlers.models.remove;
exports.setModelStatus = handlers.models.setStatus;

exports.listProcessors = handlers.processors.list;
exports.getProcessor = handlers.processors.get;
exports.createProcessor = handlers.processors.create;
exports.updateProcessor = handlers.processors.update;
exports.deleteProcessor = handlers.processors.remove;
exports.setProcessorStatus = handlers.processors.setStatus;

exports.listGenerations = handlers.generations.list;
exports.getGeneration = handlers.generations.get;
exports.createGeneration = handlers.generations.create;
exports.updateGeneration = handlers.generations.update;
exports.deleteGeneration = handlers.generations.remove;
exports.setGenerationStatus = handlers.generations.setStatus;

exports.listRam = handlers.ram.list;
exports.getRam = handlers.ram.get;
exports.createRam = handlers.ram.create;
exports.updateRam = handlers.ram.update;
exports.deleteRam = handlers.ram.remove;
exports.setRamStatus = handlers.ram.setStatus;

exports.listStorage = handlers.storage.list;
exports.getStorage = handlers.storage.get;
exports.createStorage = handlers.storage.create;
exports.updateStorage = handlers.storage.update;
exports.deleteStorage = handlers.storage.remove;
exports.setStorageStatus = handlers.storage.setStatus;

exports.listGpus = handlers.gpus.list;
exports.getGpu = handlers.gpus.get;
exports.createGpu = handlers.gpus.create;
exports.updateGpu = handlers.gpus.update;
exports.deleteGpu = handlers.gpus.remove;
exports.setGpuStatus = handlers.gpus.setStatus;

exports.listScreenSizes = handlers['screen-sizes'].list;
exports.getScreenSize = handlers['screen-sizes'].get;
exports.createScreenSize = handlers['screen-sizes'].create;
exports.updateScreenSize = handlers['screen-sizes'].update;
exports.deleteScreenSize = handlers['screen-sizes'].remove;
exports.setScreenSizeStatus = handlers['screen-sizes'].setStatus;

exports.getDropdownCatalog = async (req, res) => {
  try {
    const catalog = await getAssetCatalogForApi({ includeLegacyRows: true });
    res.json({ success: true, ...catalog });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getParentOptions = async (req, res) => {
  try {
    const entity = req.params.entity;
    const options = await listParentOptions(entity);
    res.json({ success: true, options });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listEntityTypes = async (req, res) => {
  res.json({
    success: true,
    types: Object.entries(ENTITIES).map(([key, cfg]) => ({
      key,
      label: cfg.label,
      parentKey: cfg.parentKey,
    })),
  });
};
