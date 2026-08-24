import api from '../../utils/api';

const base = '/parts';

/** Resolve a scanned QR (or a typed Part ID / serial / asset code) to a unit. */
export const lookupPartUnit = (code) => api.get(`${base}/units/lookup`, { params: { code } });

export const searchPartUnits = (params) => api.get(`${base}/units`, { params });

/**
 * Label strip PDF sized to the physical media.
 * Default: 71.6 × 15 mm page — 4 × 15 mm stickers with 3 mm gaps (1.3 mm side margin).
 */
export const buildPartLabelsPdf = (labels, {
  qrMm = 15,
  columns = 4,
  captionMm = 3,
  paperWidthMm = 71.6,
  paperHeightMm = 15,
  labelMm = 15,
  gapMm = 3,
  sideMarginMm = 1.3,
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
      label_mm: labelMm,
      gap_mm: gapMm,
      side_margin_mm: sideMarginMm,
    },
    { responseType: 'blob' }
  );

export const fetchPartsDashboard = (params) => api.get(`${base}/dashboard`, { params });
export const fetchPartsDrilldown = (params) => api.get(`${base}/dashboard/drilldown`, { params });
