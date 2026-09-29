/**
 * Carret Stock setup — Parts Catalogue and Part Repairs. Same endpoints the old
 * Parts Inventory / Part Vendor Repair screens call (routes/parts.js,
 * routes/partRequests.js, routes/partVendorRepair.js); nothing new.
 */
import api from '../../../../utils/api';
import { CATALOGUE_PART_CATEGORIES } from '../../../../constants/laptopConditions';
import { kindLabel, kindSchema } from '../../../../constants/partNaming';

export {
  listPartInstances, addPartInstances, updatePartInstance,
  updatePartInstanceFitment, bulkUpdatePartInstanceFitment,
} from '../../../floor-pipeline/partRequestsApi';
export {
  fetchPartVendorRepairDcList, fetchPartVendorRepairDc, createPartVendorReturnDc,
  fetchDefectiveEligibleForVendorReturn, dispatchPartVendorReturnDc, receivePartVendorReturnDc,
  fetchPartVendorQcPending, passPartVendorQc, failPartVendorQc, downloadPartVendorRepairPdf,
} from '../../../inventory-management/partVendorRepairApi';
export { fetchCascadeBrands, fetchCascadeModels } from '../../../../utils/assetConfigurationApi';

export const cancelPartVendorReturnDc = (dcNumber, reason) => api.post(`/part-vendor-repair/dc/${encodeURIComponent(dcNumber)}/cancel`, { reason });

export const fetchParts = () => api.get('/parts', { params: { limit: 2000 } });
export const createPart = (body) => api.post('/parts', body);
export const updatePart = (id, body) => api.put(`/parts/${id}`, body);
export const adjustPartCount = (id, delta, reason) => api.put(`/parts/${id}/quantity`, { quantity: delta, reason });
export const fetchPartUsage = (id) => api.get(`/parts/${id}/usage`);
export const fetchFitmentSettings = () => api.get('/parts/fitment-settings');
export const saveFitmentSettings = (enforcement) => api.put('/parts/fitment-settings', { enforcement });

export const errMsg = (e, fallback = 'That did not work.') => e?.response?.data?.message || e?.message || fallback;

/**
 * Catalogue categories — backend constants/laptopConditions
 * CATALOGUE_PART_CATEGORIES (the GRN missing-part list plus consumables,
 * tools and accessories).
 */
export const PART_CATEGORIES = CATALOGUE_PART_CATEGORIES;
export const CATEGORY_LABEL = Object.fromEntries(PART_CATEGORIES.map((c) => [c.value, c.label]));
/** A part's category. part_type holds the kind (ram, ssd, d_panel…), so it only stands in when it is a category. */
export const partCategory = (p) => {
  const c = String(p?.category || '').toLowerCase();
  if (CATEGORY_LABEL[c]) return c;
  const t = String(p?.part_type || '').toLowerCase();
  return CATEGORY_LABEL[t] ? t : (c || 'general');
};

/** Kind label ("RAM module", "D panel — base / bottom") or '' for a part added before the naming redesign. */
export const partKindLabel = (p) => (kindSchema(partCategory(p), p?.part_type) ? kindLabel(partCategory(p), p.part_type) : '');

/** "8 GB · DDR4 · SODIMM" — the spec values in field order. */
export function partSpecsText(p) {
  const k = kindSchema(partCategory(p), p?.part_type);
  const specs = p?.specs && typeof p.specs === 'object' ? p.specs : {};
  if (!k) return '';
  return (k.fields || []).map((f) => specs[f.key]).filter(Boolean).join(' · ');
}

/** Has the part been given a structure (category + kind + specs + fits)? */
export const isStructured = (p) => Boolean(p?.spec_key);

/**
 * Part-unit statuses are not laptop states, so each borrows the document tone
 * that means the same thing and carries its own word.
 */
export const UNIT_STATUS = {
  in_stock: { chip: 'active', label: 'In stock' },
  reserved: { chip: 'pending', label: 'Reserved' },
  installed: { chip: 'completed', label: 'Fitted' },
  with_technician: { chip: 'processing', label: 'With technician' },
  in_transit: { chip: 'dispatched', label: 'In transit' },
  defective: { chip: 'overdue', label: 'Defective' },
  qc_pending: { chip: 'pending_approval', label: 'Waiting for QC' },
  with_vendor_repair: { chip: 'dispatched', label: 'At vendor' },
  returned: { chip: 'partial', label: 'Returned' },
  discarded: { chip: 'cancelled', label: 'Discarded' },
  sold: { chip: 'closed', label: 'Sold' },
};
export const UNIT_STATUS_OPTIONS = Object.entries(UNIT_STATUS).map(([value, v]) => ({ value, label: v.label }));

export function fitsSummary(u) {
  const f = String(u?.fitment || u?.default_fitment || 'unset').toLowerCase();
  if (f === 'universal') return 'Universal';
  if (f !== 'specific') return 'Not tagged';
  const brand = u.fits_laptop_brand || (Array.isArray(u.compatible_brands) ? u.compatible_brands[0] : '') || '';
  const models = (Array.isArray(u.fits_laptop_models) ? u.fits_laptop_models
    : Array.isArray(u.compatible_models) ? u.compatible_models : []).filter(Boolean);
  if (!brand) return 'Specific';
  if (!models.length) return `${brand} (all models)`;
  if (models.length <= 2) return `${brand}: ${models.join(', ')}`;
  return `${brand}: ${models.slice(0, 2).join(', ')} +${models.length - 2}`;
}

/** A catalogue part's default fitment in the unit shape the picker edits. */
export function fitmentFromPart(p) {
  const f = String(p?.default_fitment || 'unset').toLowerCase();
  if (f === 'universal') return { fitment: 'universal', fits_laptop_brand: null, fits_laptop_models: [] };
  if (f === 'specific') {
    const brand = Array.isArray(p?.compatible_brands) && p.compatible_brands[0] ? String(p.compatible_brands[0]).trim() : null;
    if (!brand) return { fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [] };
    return {
      fitment: 'specific',
      fits_laptop_brand: brand,
      fits_laptop_models: (Array.isArray(p.compatible_models) ? p.compatible_models : []).map((m) => String(m).trim()).filter(Boolean),
    };
  }
  return { fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [] };
}

export function fitmentFromUnit(u) {
  const f = String(u?.fitment || 'unset').toLowerCase();
  if (f === 'universal') return { fitment: 'universal', fits_laptop_brand: null, fits_laptop_models: [] };
  if (f === 'specific') {
    return {
      fitment: 'specific',
      fits_laptop_brand: u.fits_laptop_brand || null,
      fits_laptop_models: (Array.isArray(u.fits_laptop_models) ? u.fits_laptop_models : []).map((m) => String(m).trim()).filter(Boolean),
    };
  }
  return { fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [] };
}

/** Picker value → the catalogue's default_fitment / compatible_* fields. */
export function catalogFitmentFields(v) {
  if (v?.fitment === 'universal') return { default_fitment: 'universal', compatible_brands: [], compatible_models: [] };
  if (v?.fitment === 'specific' && v.fits_laptop_brand) {
    return { default_fitment: 'specific', compatible_brands: [v.fits_laptop_brand], compatible_models: v.fits_laptop_models || [] };
  }
  return { default_fitment: 'unset', compatible_brands: [], compatible_models: [] };
}

/** One unit → the shape PartLabelPrintModal prints. */
export const labelUnit = (u, partName) => ({
  code: u.prt_id,
  title: u.part_name || partName || '',
  subtitle: u.serial_number ? `Serial ${u.serial_number}` : 'No serial',
  poNumber: u.purchase_order_number || '',
  serialNumber: u.serial_number || '',
});

/** Roles the unit-write API lets through besides the matrix (routes/partRequests.js). */
export const PART_UNIT_WRITE_ROLES = ['warehouse', 'admin', 'manager', 'super_admin'];
/** services/partVendorRepairService.js WAREHOUSE_ROLES — the repair-DC write fallback. */
export const PART_REPAIR_WRITE_ROLES = ['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead', 'procurement'];

/** Part repair challan (VRDC, item_domain 'part') header states. */
export const REPAIR_DC_STATUS = {
  draft: { chip: 'draft', label: 'Draft — not sent' },
  dispatched: { chip: 'dispatched', label: 'With vendor' },
  partially_returned: { chip: 'partial', label: 'Part back' },
  returned: { chip: 'completed', label: 'All back' },
  cancelled: { chip: 'cancelled', label: 'Cancelled' },
};
export const REPAIR_LINE_STATUS = {
  draft: { chip: 'draft', label: 'Not sent' },
  dispatched: { chip: 'dispatched', label: 'With vendor' },
  received: { chip: 'received', label: 'Back — repaired' },
  replacement_received: { chip: 'received', label: 'Back — replaced' },
  cancelled: { chip: 'cancelled', label: 'Cancelled' },
};
export const repairDcPath = (dc) => `/carret/stock/part-repairs/${encodeURIComponent(dc)}`;

export const splitSerials = (text) => String(text || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
