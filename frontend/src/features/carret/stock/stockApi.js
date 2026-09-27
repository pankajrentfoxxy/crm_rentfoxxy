/** Carret Stock — calls for the Stock screens (backend routes/stock.js, claude/carret-stock.md). */
import api from '../../../utils/api';

export const fetchAssets = (params) => api.get('/stock/assets', { params });
export const fetchAssetCounts = () => api.get('/stock/assets/counts');
export const fetchAsset = (id) => api.get(`/stock/assets/${encodeURIComponent(id)}`);
export const fetchReadyStock = () => api.get('/stock/ready');
export const fetchCarret = (carret) => api.get('/stock/carrets', { params: { carret } });
export const retag = (serialIds, tag, reason) => api.post('/stock/retag', { serial_ids: serialIds, tag, reason });
export const setLocation = (serialId, carret, slot, reason) => api.post('/stock/location', { serial_id: serialId, carret, slot, reason });
export const sendToQc = (serialId, serialNumber) => api.post('/inventory-management/qc-process/move-from-passed', { serial_number_id: serialId, serial_number: serialNumber });

export const fetchScrapRequests = (status) => api.get('/stock/scrap-requests', { params: { status } });
export const requestScrap = (serialId, reason) => api.post('/stock/scrap-requests', { serial_id: serialId, reason });
export const decideScrap = (id, approve, note) => api.post(`/stock/scrap-requests/${id}/decide`, { approve, note });
export const cancelScrap = (id) => api.post(`/stock/scrap-requests/${id}/cancel`, {});
export const fetchScrappedAwaitingChallan = () => api.get('/stock/scrap/awaiting-challan');
export const fetchScrapChallans = (params) => api.get('/scrap-challans/dc', { params });
export const createScrapChallan = (body) => api.post('/scrap-challans/create', body);

export const fetchNotEarning = (days) => api.get('/stock/not-earning', { params: { days } });

export const TAG_OPTIONS = [
  { value: 'rental', label: 'Rent' },
  { value: 'sale', label: 'Sell' },
  { value: 'both', label: 'Rent or sell' },
];

export const errMsg = (e, fallback = 'That did not work.') => e?.response?.data?.message || e?.message || fallback;
