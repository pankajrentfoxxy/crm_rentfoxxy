/** Dispatched when inventory list data changes so Layout sidebar badges can refresh. */
export const INVENTORY_COUNTS_INVALIDATE = 'inventory-management:counts-invalidate';

export function invalidateInventoryCounts() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INVENTORY_COUNTS_INVALIDATE));
  }
}
