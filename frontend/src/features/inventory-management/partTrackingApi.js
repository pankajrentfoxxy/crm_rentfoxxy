import api from '../../utils/api';

const base = '/parts';

/** Resolve a scanned QR (or a typed Part ID / serial / asset code) to a unit. */
export const lookupPartUnit = (code) => api.get(`${base}/units/lookup`, { params: { code } });

export const searchPartUnits = (params) => api.get(`${base}/units`, { params });

/**
 * Label sheet as a PDF blob, one page per physical sticker at the exact
 * millimetre size so the label printer does not rescale it. `captionMm`
 * reserves a band under the QR for readable text (the PO number).
 */
export const buildPartLabelsPdf = (labels, { widthMm, heightMm, captionMm = 0 } = {}) =>
  api.post(
    `${base}/labels/print`,
    {
      labels,
      width_mm: widthMm,
      height_mm: heightMm ?? widthMm + captionMm,
      caption_mm: captionMm,
    },
    { responseType: 'blob' }
  );

export const fetchPartsDashboard = (params) => api.get(`${base}/dashboard`, { params });
export const fetchPartsDrilldown = (params) => api.get(`${base}/dashboard/drilldown`, { params });
