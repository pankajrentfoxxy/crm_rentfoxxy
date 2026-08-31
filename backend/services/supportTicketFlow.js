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
  if (item.outcome === 'replacement_required') {
    return 'replacement_required';
  }
  if (!item.assigned_to) return 'unassigned';
  // Step order: the technician first marks "reached" (capturing GPS), then
  // verifies the laptop TTSPL/serial before recording an outcome.
  if (!item.visited_at) return 'assigned';
  if (
    !item.ttspl_verified
    && !item.outcome && !item.work_done_at && !item.pod_image_path
    && (item.ttspl_id || item.unique_serial_number || item.serial_number)
  ) {
    return 'verify_ttspl';
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
  const pickupType = item.pickup_type || (item.source_item_id ? 'repair' : 'return');
  const isRepair = pickupType === 'repair';
  // Phase 20: redesigned pickup flow is the default for every pickup item.
  // Assigned -> Reached -> POD -> Customer OTP -> Guard inward -> Warehouse confirmed.
  // Only the deprecated Phase 18 self-carry / loan-machine flow is treated as
  // legacy, and only when explicitly marked (so older tickets keep working).
  const isLegacy = !item.pickup_type
    && (item.pickup_method === 'self_carry' || item.loan_delivered_at);
  if (!isLegacy) {
    if (item.status === 'pending_dispatch' || (item.return_dc_number && !item.pickup_method && !item.assigned_to && !item.pickup_assigned_to)) {
      return 'pending_dispatch';
    }
    if (isRepair) {
      if (item.service_dc_status === 'delivered' || item.service_dc_delivered_at) return 'warehouse_confirmed';
      if (item.service_dc_number) return 'service_dc_pending';
      if (item.status === 'awaiting_service_return' || item.warehouse_received_at) return 'awaiting_service_return';
    } else if (item.warehouse_received_at || CLOSED.has(item.status)) {
      return 'warehouse_confirmed';
    }
    const hasRdc = !!item.return_dc_number;
    const gateDone = !!item.gate_inward_at;
    if (item.customer_otp_verified_at) {
      if (hasRdc && !gateDone) return 'gate_inward';
      if (hasRdc && gateDone) return 'gate_inward_done';
      return 'customer_otp';
    }
    const isCourierOrPorter = item.pickup_method === 'courier' || item.pickup_method === 'porter';
    if (isCourierOrPorter && hasRdc && gateDone) return 'gate_inward_done';
    if (item.pod_image_path || item.proof_of_completion_path) return 'pod_uploaded';
    if (item.visited_at) return 'reached';
    return 'assigned';
  }
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
