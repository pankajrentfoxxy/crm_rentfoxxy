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
  getMappingTree,
  bulkCreateChildren,
  reassignChildren,
  bulkDeleteChildren,
  bulkSetChildStatus,
  getLaptopSpecMappingTree,
  bulkAddProcessorsToBrand,
  bulkAddModelsToBrand,
  bulkAddGenerationsToBrand,
  bulkAddGenerationsToBrandProcessor,
  bulkDeleteBrandProcessors,
  bulkDeleteBrandModels,
  bulkDeleteBrandGenerations,
  bulkDeleteBrandProcessorGenerations,
  bulkSetBrandProcessorStatus,
  bulkSetBrandModelStatus,
  bulkSetBrandGenerationStatus,
  bulkSetBrandProcessorGenerationStatus,
  ensureAssetConfigurationSchema,
  listCascadeBrands,
  listCascadeSpecMasters,
  listInventorySpecFilterOptions,
  listCascadeModelsForBrand,
  listCascadeProcessorsForBrand,
  listCascadeGenerationsForBrand,
  listCascadeGenerationsForBrandProcessor,
} = require('../services/assetConfigurationService');

// Mapping view types -> the child entity whose parent relationship is managed.
const MAPPING_TYPES = {
  'brand-models': { child: 'models', parentLabel: 'Brand', childLabel: 'Model' },
  'processor-generations': { child: 'generations', parentLabel: 'Processor', childLabel: 'Generation' },
};

function mappingChild(req, res) {
  const meta = MAPPING_TYPES[req.params.type];
  if (!meta) {
    res.status(404).json({ success: false, message: `Unknown mapping type: ${req.params.type}` });
    return null;
  }
  return meta;
}

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

exports.listSpareBrands = handlers['spare-brands'].list;
exports.getSpareBrand = handlers['spare-brands'].get;
exports.createSpareBrand = handlers['spare-brands'].create;
exports.updateSpareBrand = handlers['spare-brands'].update;
exports.deleteSpareBrand = handlers['spare-brands'].remove;
exports.setSpareBrandStatus = handlers['spare-brands'].setStatus;

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

exports.listCascadeBrands = async (req, res) => {
  try {
    const brands = await listCascadeBrands();
    res.json({ success: true, brands });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listCascadeSpecMasters = async (req, res) => {
  try {
    const specs = await listCascadeSpecMasters();
    res.json({ success: true, ...specs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listInventorySpecFilterOptions = async (req, res) => {
  try {
    const options = await listInventorySpecFilterOptions();
    res.json({ success: true, ...options });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listCascadeModelsForBrand = async (req, res) => {
  try {
    const data = await listCascadeModelsForBrand(decodeURIComponent(req.params.brandName || ''));
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.listCascadeProcessorsForBrand = async (req, res) => {
  try {
    const data = await listCascadeProcessorsForBrand(decodeURIComponent(req.params.brandName || ''));
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.listCascadeGenerationsForBrand = async (req, res) => {
  try {
    const data = await listCascadeGenerationsForBrand(decodeURIComponent(req.params.brandName || ''));
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.listCascadeGenerationsForBrandProcessor = async (req, res) => {
  try {
    const data = await listCascadeGenerationsForBrandProcessor(
      decodeURIComponent(req.params.brandName || ''),
      decodeURIComponent(req.params.processorName || '')
    );
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
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

exports.getMapping = async (req, res) => {
  const meta = mappingChild(req, res);
  if (!meta) return;
  try {
    const tree = await getMappingTree(meta.child);
    res.json({ success: true, parentLabel: meta.parentLabel, childLabel: meta.childLabel, parents: tree });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkCreateMapping = async (req, res) => {
  const meta = mappingChild(req, res);
  if (!meta) return;
  try {
    const result = await bulkCreateChildren(meta.child, req.body.parent_id, req.body.names, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.reassignMapping = async (req, res) => {
  const meta = mappingChild(req, res);
  if (!meta) return;
  try {
    const result = await reassignChildren(meta.child, req.body.ids, req.body.parent_id, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkDeleteMapping = async (req, res) => {
  const meta = mappingChild(req, res);
  if (!meta) return;
  try {
    const result = await bulkDeleteChildren(meta.child, req.body.ids, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkStatusMapping = async (req, res) => {
  const meta = mappingChild(req, res);
  if (!meta) return;
  try {
    const result = await bulkSetChildStatus(meta.child, req.body.ids, req.body.status, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.getLaptopSpecMapping = async (req, res) => {
  try {
    const brands = await getLaptopSpecMappingTree();
    res.json({ success: true, brands });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkAddBrandModels = async (req, res) => {
  try {
    const result = await bulkAddModelsToBrand(
      req.body.brand_id,
      req.body.model_ids,
      req.user.user_id
    );
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkAddBrandProcessors = async (req, res) => {
  try {
    const result = await bulkAddProcessorsToBrand(
      req.body.brand_id,
      req.body.processor_ids,
      req.user.user_id
    );
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkAddBrandGenerations = async (req, res) => {
  try {
    const result = await bulkAddGenerationsToBrand(
      req.body.brand_id,
      req.body.generation_ids,
      req.user.user_id
    );
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkAddBrandProcessorGenerations = async (req, res) => {
  try {
    const result = await bulkAddGenerationsToBrand(
      req.body.brand_id,
      req.body.generation_ids,
      req.user.user_id
    );
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkDeleteBrandModels = async (req, res) => {
  try {
    const result = await bulkDeleteBrandModels(req.body.ids, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkDeleteBrandProcessors = async (req, res) => {
  try {
    const result = await bulkDeleteBrandProcessors(req.body.ids, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkDeleteBrandGenerations = async (req, res) => {
  try {
    const result = await bulkDeleteBrandGenerations(req.body.ids, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkDeleteBrandProcessorGenerations = async (req, res) => {
  try {
    const result = await bulkDeleteBrandProcessorGenerations(req.body.ids, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkStatusBrandModels = async (req, res) => {
  try {
    const result = await bulkSetBrandModelStatus(req.body.ids, req.body.status, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkStatusBrandProcessors = async (req, res) => {
  try {
    const result = await bulkSetBrandProcessorStatus(req.body.ids, req.body.status, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkStatusBrandGenerations = async (req, res) => {
  try {
    const result = await bulkSetBrandGenerationStatus(req.body.ids, req.body.status, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.bulkStatusBrandProcessorGenerations = async (req, res) => {
  try {
    const result = await bulkSetBrandProcessorGenerationStatus(req.body.ids, req.body.status, req.user.user_id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.ensureAssetConfigurationSchema = ensureAssetConfigurationSchema;

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
