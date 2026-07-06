import api from './api';

const base = '/asset-configuration';

export const fetchAssetDropdowns = () => api.get(`${base}/dropdowns`);

export const fetchCascadeBrands = () => api.get(`${base}/cascade/brands`);
export const fetchCascadeSpecMasters = () => api.get(`${base}/cascade/spec-masters`);
export const fetchInventorySpecFilterOptions = (params = {}) =>
  api.get(`${base}/cascade/filter-options`, { params });
export const fetchCascadeProcessors = (brandName) =>
  api.get(`${base}/cascade/brands/${encodeURIComponent(brandName)}/processors`);
export const fetchCascadeModels = (brandName) =>
  api.get(`${base}/cascade/brands/${encodeURIComponent(brandName)}/models`);
export const fetchCascadeGenerations = (brandName) =>
  api.get(`${base}/cascade/brands/${encodeURIComponent(brandName)}/generations`);
export const fetchCascadeGenerationsByProcessor = (brandName, processorName) =>
  api.get(`${base}/cascade/brands/${encodeURIComponent(brandName)}/processors/${encodeURIComponent(processorName)}/generations`);

export const listBrands = (p) => api.get(`${base}/brands`, { params: p });
export const createBrand = (d) => api.post(`${base}/brands`, d);
export const updateBrand = (id, d) => api.put(`${base}/brands/${id}`, d);
export const deleteBrand = (id) => api.delete(`${base}/brands/${id}`);
export const setBrandStatus = (id, status) => api.patch(`${base}/brands/${id}/status`, { status });

export const listSpareBrands = (p) => api.get(`${base}/spare-brands`, { params: p });
export const createSpareBrand = (d) => api.post(`${base}/spare-brands`, d);
export const updateSpareBrand = (id, d) => api.put(`${base}/spare-brands/${id}`, d);
export const deleteSpareBrand = (id) => api.delete(`${base}/spare-brands/${id}`);
export const setSpareBrandStatus = (id, status) => api.patch(`${base}/spare-brands/${id}/status`, { status });

export const listModels = (p) => api.get(`${base}/models`, { params: p });
export const createModel = (d) => api.post(`${base}/models`, d);
export const updateModel = (id, d) => api.put(`${base}/models/${id}`, d);
export const deleteModel = (id) => api.delete(`${base}/models/${id}`);
export const setModelStatus = (id, status) => api.patch(`${base}/models/${id}/status`, { status });

export const listProcessors = (p) => api.get(`${base}/processors`, { params: p });
export const createProcessor = (d) => api.post(`${base}/processors`, d);
export const updateProcessor = (id, d) => api.put(`${base}/processors/${id}`, d);
export const deleteProcessor = (id) => api.delete(`${base}/processors/${id}`);
export const setProcessorStatus = (id, status) => api.patch(`${base}/processors/${id}/status`, { status });

export const listGenerations = (p) => api.get(`${base}/generations`, { params: p });
export const createGeneration = (d) => api.post(`${base}/generations`, d);
export const updateGeneration = (id, d) => api.put(`${base}/generations/${id}`, d);
export const deleteGeneration = (id) => api.delete(`${base}/generations/${id}`);
export const setGenerationStatus = (id, status) => api.patch(`${base}/generations/${id}/status`, { status });

export const listRam = (p) => api.get(`${base}/ram`, { params: p });
export const createRam = (d) => api.post(`${base}/ram`, d);
export const updateRam = (id, d) => api.put(`${base}/ram/${id}`, d);
export const deleteRam = (id) => api.delete(`${base}/ram/${id}`);
export const setRamStatus = (id, status) => api.patch(`${base}/ram/${id}/status`, { status });

export const listStorage = (p) => api.get(`${base}/storage`, { params: p });
export const createStorage = (d) => api.post(`${base}/storage`, d);
export const updateStorage = (id, d) => api.put(`${base}/storage/${id}`, d);
export const deleteStorage = (id) => api.delete(`${base}/storage/${id}`);
export const setStorageStatus = (id, status) => api.patch(`${base}/storage/${id}/status`, { status });

export const listGpus = (p) => api.get(`${base}/gpus`, { params: p });
export const createGpu = (d) => api.post(`${base}/gpus`, d);
export const updateGpu = (id, d) => api.put(`${base}/gpus/${id}`, d);
export const deleteGpu = (id) => api.delete(`${base}/gpus/${id}`);
export const setGpuStatus = (id, status) => api.patch(`${base}/gpus/${id}/status`, { status });

export const listScreenSizes = (p) => api.get(`${base}/screen-sizes`, { params: p });
export const createScreenSize = (d) => api.post(`${base}/screen-sizes`, d);
export const updateScreenSize = (id, d) => api.put(`${base}/screen-sizes/${id}`, d);
export const deleteScreenSize = (id) => api.delete(`${base}/screen-sizes/${id}`);
export const setScreenSizeStatus = (id, status) => api.patch(`${base}/screen-sizes/${id}/status`, { status });

export const fetchParentOptions = (entity) => api.get(`${base}/parents/${entity}`);

// Parent ↔ child mapping (type = 'brand-models' | 'processor-generations')
export const fetchMapping = (type) => api.get(`${base}/mappings/${type}`);
export const bulkCreateMapping = (type, parentId, names) =>
  api.post(`${base}/mappings/${type}/bulk-create`, { parent_id: parentId, names });
export const reassignMapping = (type, ids, parentId) =>
  api.post(`${base}/mappings/${type}/reassign`, { ids, parent_id: parentId });
export const bulkDeleteMapping = (type, ids) =>
  api.post(`${base}/mappings/${type}/bulk-delete`, { ids });
export const bulkStatusMapping = (type, ids, status) =>
  api.post(`${base}/mappings/${type}/bulk-status`, { ids, status });

export const fetchLaptopSpecMapping = () => api.get(`${base}/mappings/laptop-spec/tree`);
export const bulkAddBrandModels = (brandId, modelIds) =>
  api.post(`${base}/mappings/laptop-spec/models/bulk-add`, { brand_id: brandId, model_ids: modelIds });
export const bulkAddBrandProcessors = (brandId, processorIds) =>
  api.post(`${base}/mappings/laptop-spec/processors/bulk-add`, { brand_id: brandId, processor_ids: processorIds });
export const bulkAddBrandGenerations = (brandId, generationIds) =>
  api.post(`${base}/mappings/laptop-spec/generations/bulk-add`, { brand_id: brandId, generation_ids: generationIds });
export const bulkAddBrandProcessorGenerations = (brandId, processorId, generationIds) =>
  api.post(`${base}/mappings/laptop-spec/generations/bulk-add`, {
    brand_id: brandId,
    generation_ids: generationIds,
  });
export const bulkDeleteBrandModels = (ids) =>
  api.post(`${base}/mappings/laptop-spec/models/bulk-delete`, { ids });
export const bulkDeleteBrandProcessors = (ids) =>
  api.post(`${base}/mappings/laptop-spec/processors/bulk-delete`, { ids });
export const bulkDeleteBrandGenerations = (ids) =>
  api.post(`${base}/mappings/laptop-spec/generations/bulk-delete`, { ids });
export const bulkDeleteBrandProcessorGenerations = bulkDeleteBrandGenerations;
export const bulkStatusBrandModels = (ids, status) =>
  api.post(`${base}/mappings/laptop-spec/models/bulk-status`, { ids, status });
export const bulkStatusBrandProcessors = (ids, status) =>
  api.post(`${base}/mappings/laptop-spec/processors/bulk-status`, { ids, status });
export const bulkStatusBrandGenerations = (ids, status) =>
  api.post(`${base}/mappings/laptop-spec/generations/bulk-status`, { ids, status });
export const bulkStatusBrandProcessorGenerations = bulkStatusBrandGenerations;
