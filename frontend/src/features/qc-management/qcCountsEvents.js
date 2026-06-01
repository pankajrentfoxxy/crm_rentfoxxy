/** Dispatched when QC list status changes so Layout sidebar badges can refresh. */
export const QC_COUNTS_INVALIDATE = 'qc-management:counts-invalidate';

export function invalidateQcCounts() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QC_COUNTS_INVALIDATE));
  }
}
