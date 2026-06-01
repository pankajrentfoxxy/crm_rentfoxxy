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

export function fetchSparePartsList(params) {
  return api.get(`${base}/spare-parts`, { params });
}
