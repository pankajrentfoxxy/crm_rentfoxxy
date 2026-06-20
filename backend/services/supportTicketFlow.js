/**
 * Derives UI gating step for support ticket items (v3).
 * Merges legacy status fields when current_step is null.
 */

const CLOSED = new Set(['resolved', 'closed', 'inventory_updated']);

const deriveComplaintStep = (item) => {
  if (CLOSED.has(item.status)) return 'otp_verified';
  // Phase 18: laptop carried away for warehouse repair supersedes the complaint.
  if (item.status === 'picked_up' || item.outcome === 'repair_required') {
    return 'picked_up_for_repair';
  }
  if (
    item.outcome === 'replacement_required'
    || item.status === 'repair_failed'
    || (item.replacement_flag_reason && item.replacement_flagged_by)
  ) {
    return 'replacement_required';
  }
  if (!item.assigned_to) return 'unassigned';
  if (!item.visited_at) {
    // Phase 18: TTSPL/serial must be verified before the technician can mark reached.
    // Only gates the pre-visit stage so items already visited keep progressing.
    if (!item.ttspl_verified && (item.ttspl_id || item.unique_serial_number || item.serial_number)) {
      return 'verify_ttspl';
    }
    return 'assigned';
  }
  if (item.outcome === 'working') return 'working';
  if (!item.outcome) {
    if (item.work_done_at || item.status === 'awaiting_otp') {
      if (!item.pod_image_path) return 'fixed_pending_pod';
      if (!item.otp_verified_at) return 'pod_uploaded';
      return 'otp_verified';
    }
    return 'visited';
  }
  if (item.outcome === 'fixed') {
    if (!item.pod_image_path) return 'fixed_pending_pod';
    if (!item.otp_verified_at) return 'pod_uploaded';
    return 'otp_verified';
  }
  return 'visited';
};

const derivePickupStep = (item) => {
  if (CLOSED.has(item.status)) return 'otp_verified';
  // Phase 18: self-carry pickup (technician carries faulty laptop to warehouse).
  if (item.pickup_method === 'self_carry' || item.status === 'in_transit') {
    if (item.reached_warehouse_at) return 'reached_warehouse';
    return 'in_transit';
  }
  if (!item.assigned_to) return 'unassigned';
  if (item.loan_delivered_at && !item.picked_up_at) {
    const min = new Date(item.loan_delivered_at).getTime() + 72 * 60 * 60 * 1000;
    if (Date.now() < min) return 'wait_72h';
  }
  if (!item.picked_up_at) return 'pickup_action';
  if (!item.pod_image_path) return 'fixed_pending_pod';
  if (item.warehouse_otp_verified_at || item.otp_verified_at) return 'otp_verified';
  if (item.warehouse_otp_code || item.otp_code) return 'warehouse_otp';
  return 'pod_uploaded';
};

const deriveReplacementStep = (item, order) => {
  if (CLOSED.has(item.status)) return 'otp_verified';
  const st = String(order?.status || item.status || 'placed').toLowerCase();
  if (st === 'flagged') return 'flagged';
  if (st === 'approved' || st === 'placed' || st === 'order_placed') return 'approved';
  if (st === 'dispatched') return 'dispatched';
  if (st === 'out_for_delivery') return 'out_for_delivery';
  if (st === 'delivered' && order && !order.delivery_otp_verified_at) return 'delivered_pending_otp';
  if (st === 'pickup_open') return 'pickup_open';
  if (st === 'pickup_done') return 'pickup_done';
  if (st === 'inventory_updated') return 'otp_verified';
  return 'approved';
};

exports.deriveItemCurrentStep = (item, replacementOrder) => {
  if (item.item_type === 'pickup') return derivePickupStep(item);
  if (item.item_type === 'replacement') return deriveReplacementStep(item, replacementOrder);
  return deriveComplaintStep(item);
};

exports.isTerminalItem = (item) => CLOSED.has(item.status);
