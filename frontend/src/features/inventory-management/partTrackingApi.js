import api from '../../utils/api';

const base = '/parts';

/** Resolve a scanned QR (or a typed Part ID / serial / asset code) to a unit. */
export const lookupPartUnit = (code) => api.get(`${base}/units/lookup`, { params: { code } });

export const searchPartUnits = (params) => api.get(`${base}/units`, { params });

/**
 * Label strip PDF sized to the physical media.
 * Default: 102.6 × 15 mm page with 4 × 15 mm QRs across; PO text under each QR.
 */
export const buildPartLabelsPdf = (labels, {
  qrMm = 15,
  columns = 4,
  captionMm = 3,
  paperWidthMm = 102.6,
  paperHeightMm = 15,
} = {}) =>
  api.post(
    `${base}/labels/print`,
    {
      labels,
      qr_mm: qrMm,
      columns,
      caption_mm: captionMm,
      paper_width_mm: paperWidthMm,
      paper_height_mm: paperHeightMm,
    },
    { responseType: 'blob' }
  );

export const fetchPartsDashboard = (params) => api.get(`${base}/dashboard`, { params });
export const fetchPartsDrilldown = (params) => api.get(`${base}/dashboard/drilldown`, { params });
