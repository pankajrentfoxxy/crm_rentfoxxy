import api from '../../utils/api';

const base = '/inventory-management';

export function fetchInventoryList(segment, params, config = {}) {
  return api.get(`${base}/lists/${encodeURIComponent(segment)}`, { params, ...config });
}

function downloadBlobResponse(response, fallbackName) {
  const blob = new Blob([response.data], {
    type: response.headers['content-type'] || 'application/octet-stream',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  const disposition = response.headers['content-disposition'] || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  a.href = url;
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function exportInventoryListExcel(segment, params = {}) {
  const response = await api.get(`${base}/lists/${encodeURIComponent(segment)}/export.xlsx`, {
    params,
    responseType: 'blob',
  });
  downloadBlobResponse(response, `${segment}_inventory.xlsx`);
}

export function fetchInventoryListCounts() {
  return api.get(`${base}/lists/counts`);
}

export function fetchSerialNumberStatus(serialNumber) {
  return api.get(`${base}/serial-number-status`, { params: { serial_number: serialNumber } });
}

export function fetchUniversalSearch(search) {
  return api.get(`${base}/universal-search`, { params: { search } });
}

/** Laptops currently deployed with customers (rented / on demo / in transit / sold) */
export function fetchCustomerAssets(params) {
  return api.get(`${base}/customer-assets`, { params });
}

export function fetchSparePartsList(params) {
  return api.get(`${base}/spare-parts`, { params });
}

/** Laravel inventoryListChangeStatus for serial_number_parts */
export function updateSparePartStatus(body) {
  return api.post(`${base}/spare-parts/change-status`, body);
}

/** Laravel ReturnAndRepareCheckXYZ — sets serial status2 for ready-to-rent list */
export function updateReadyToRentSaleAction(body) {
  return api.post(`${base}/ready-to-rent-action`, body);
}

/** Super admin — correct item description on Ready to Rent/Sell */
export function updateInventoryItemDescription(serialId, body) {
  return api.patch(`${base}/${serialId}/item-description`, body);
}

/** Super admin — set qc_status / inventory_status (sync lists + optional floor ticket) */
export function updateSerialQcStatus(serialId, body) {
  return api.patch(`${base}/${serialId}/qc-status`, body);
}

/** Phase 2 — tag serial as rental or sales */
export function tagInventorySerial(serialId, tag) {
  return api.patch(`${base}/${serialId}/tag`, { tag });
}

/** Admin — add laptop directly into QC Process (pending) + floor ticket */
export function addLaptopToQcProcess(body) {
  return api.post(`${base}/qc-process/add-laptop`, body);
}

/** Move QC passed serial back to QC Process + floor ticket if needed */
export function movePassedToQcProcess(body) {
  return api.post(`${base}/qc-process/move-from-passed`, body);
}

/** Create Production/Floor ticket for a laptop in QC Process (pending) */
export function createProductionTicket(body) {
  return api.post(`${base}/qc-process/create-production-ticket`, body);
}
