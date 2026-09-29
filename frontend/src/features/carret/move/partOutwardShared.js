/**
 * Dead / physical parts outward (Part DC) — shared words for the list and the
 * record page. Status values are the backend's physical_part_outwards.status.
 */
export const OUTWARD_STATUS = {
  draft: { chip: 'pending_approval', label: 'Awaiting approval' },
  dispatch_ready: { chip: 'sent', label: 'Part DC ready — at the gate' },
  dispatched: { chip: 'completed', label: 'Gone out' },
  cancelled: { chip: 'cancelled', label: 'Cancelled' },
};

export const outwardRecordPath = (no) => `/carret/move/part-inward/outwards/${encodeURIComponent(no)}`;
