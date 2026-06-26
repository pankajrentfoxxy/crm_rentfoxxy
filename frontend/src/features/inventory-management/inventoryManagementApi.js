import api from '../../utils/api';

const base = '/inventory-management';

export function fetchInventoryList(segment, params) {
  return api.get(`${base}/lists/${encodeURIComponent(segment)}`, { params });
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

/** Phase 2 — tag serial as rental or sales */
export function tagInventorySerial(serialId, tag) {
  return api.patch(`${base}/${serialId}/tag`, { tag });
}

/** Admin — add laptop directly into QC Process (pending) + floor ticket */
export function addLaptopToQcProcess(body) {
  return api.post(`${base}/qc-process/add-laptop`, body);
}

/** Admin — move QC passed serial back to QC Process + floor ticket if needed */
export function movePassedToQcProcess(body) {
  return api.post(`${base}/qc-process/move-from-passed`, body);
}
