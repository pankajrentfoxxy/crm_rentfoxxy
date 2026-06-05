/** Dispatched when inventory list data changes so Layout sidebar badges can refresh. */
export const INVENTORY_COUNTS_INVALIDATE = 'inventory-management:counts-invalidate';

/** Dispatched when open inventory list tables should reload (e.g. after PO receive or QC pass). */
export const INVENTORY_LIST_INVALIDATE = 'inventory-management:list-invalidate';

export function invalidateInventoryCounts() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INVENTORY_COUNTS_INVALIDATE));
  }
}

export function invalidateInventoryLists() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INVENTORY_LIST_INVALIDATE));
  }
}

/** Refresh sidebar badges and any mounted inventory list pages. */
export function invalidateInventoryManagement() {
  invalidateInventoryCounts();
  invalidateInventoryLists();
}
