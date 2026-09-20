/**
 * Fixture for <Timeline> until Part 2.1 builds the events table.
 *
 * The shape IS that table's row — occurred_at, actor_name, event_type,
 * from_state, to_state, entity_ref, source, correlation_id — so wiring it to
 * real data in Part 2 is a swap of the data source and nothing else.
 *
 * The correlation ids are the point of the fixture: `dc-8821` repeats across
 * four rows because one delivery currently writes from several paths (finding
 * V1). Once Part 3 collapses them, that group becomes one row and this fixture
 * stops being an accurate picture of the system — which is the intended result.
 */
export const ASSET_TIMELINE_FIXTURE = [
  { event_id: 1,  occurred_at: '2026-04-02T10:12:00+05:30', actor_type: 'user',      actor_name: 'Ravi (procurement)', event_type: 'grn_received',        from_state: null,             to_state: 'in_stock',       entity_ref: 'PO-0004',          source: 'grnTicketService',      correlation_id: 'grn-104' },
  { event_id: 2,  occurred_at: '2026-04-02T10:13:00+05:30', actor_type: 'system',    actor_name: 'system',             event_type: 'qc_status_set',       from_state: null,             to_state: 'passed',         entity_ref: 'PO-0004',          source: 'grnTicketService',      correlation_id: 'grn-104' },
  { event_id: 3,  occurred_at: '2026-05-18T16:40:00+05:30', actor_type: 'user',      actor_name: 'Nisha (sales)',      event_type: 'attached_to_order',   from_state: 'in_stock',       to_state: 'reserved',       entity_ref: 'SO/26-27/0412',    source: 'salesOrderSerialController', correlation_id: 'so-412' },
  { event_id: 4,  occurred_at: '2026-05-20T09:05:00+05:30', actor_type: 'user',      actor_name: 'Imran (dispatch)',   event_type: 'challan_created',     from_state: 'reserved',       to_state: 'dispatch_ready', entity_ref: 'DC/26-27/0778',    source: 'salesManagementController',  correlation_id: 'dc-8821' },
  { event_id: 5,  occurred_at: '2026-05-20T11:32:00+05:30', actor_type: 'user',      actor_name: 'Gate 1',             event_type: 'gate_outward',        from_state: 'dispatch_ready', to_state: 'in_transit',     entity_ref: 'DC/26-27/0778',    source: 'guardGateValidationService', correlation_id: 'dc-8821' },
  { event_id: 6,  occurred_at: '2026-05-21T15:20:00+05:30', actor_type: 'courier',   actor_name: 'BlueDart',           event_type: 'delivery_scan',       from_state: null,             to_state: null,             entity_ref: 'AWB 7781104432',   source: 'bluedartAwbSyncService',     correlation_id: 'dc-8821', note: 'Delivered scan received from carrier' },
  { event_id: 7,  occurred_at: '2026-05-21T15:22:00+05:30', actor_type: 'system',    actor_name: 'system',             event_type: 'delivered',           from_state: 'in_transit',     to_state: 'rented',         entity_ref: 'DC/26-27/0778',    source: 'salesManagementController',  correlation_id: 'dc-8821' },
  { event_id: 8,  occurred_at: '2026-06-01T02:00:00+05:30', actor_type: 'system',    actor_name: 'billing cron',       event_type: 'invoiced',            from_state: null,             to_state: null,             entity_ref: 'INV-1129',         source: 'billingSchedulerService',    correlation_id: 'bill-2606', note: 'Rs 2,499 for 21 May - 31 May' },
  { event_id: 9,  occurred_at: '2026-08-14T11:00:00+05:30', actor_type: 'customer',  actor_name: 'Synergie Network',   event_type: 'support_raised',      from_state: null,             to_state: null,             entity_ref: 'TKT-3341',         source: 'supportRequestController',   correlation_id: 'tkt-3341', note: 'Keyboard not responding' },
  { event_id: 10, occurred_at: '2026-08-16T09:30:00+05:30', actor_type: 'user',      actor_name: 'Arun (technician)',  event_type: 'picked_up_for_repair', from_state: 'rented',        to_state: 'in_repair',      entity_ref: 'TKT-3341',         source: 'supportController',          correlation_id: 'tkt-3341' },
  { event_id: 11, occurred_at: '2026-08-29T17:45:00+05:30', actor_type: 'user',      actor_name: 'Arun (technician)',  event_type: 'returned_to_customer', from_state: 'in_repair',     to_state: 'rented',         entity_ref: 'SDC/26-27/0006',   source: 'supportServiceDcService',    correlation_id: 'tkt-3341' },
  { event_id: 12, occurred_at: '2026-09-01T02:00:00+05:30', actor_type: 'system',    actor_name: 'billing cron',       event_type: 'credit_note_raised',  from_state: null,             to_state: null,             entity_ref: 'CN-0271',          source: 'billingSchedulerService',    correlation_id: 'bill-2609', note: 'Rs 1,082.90 credited for 13 warehouse days' },
];

export const ASSET_FIXTURE = {
  ttspl_id: 'TTSPL4227',
  serial_number: 'JH7K2L9',
  inventory_status: 'rented',
  qc_status: 'passed',
  entity: 'rental',
  brand: 'Dell',
  model: 'Latitude 5420',
  processor: 'Intel i5',
  generation: '11th',
  ram: '16GB',
  storage: '512GB SSD',
  customer_name: 'Synergie Network Engineering India Pvt Ltd',
  rent_monthly_rate: 2499,
  rent_billed_until: '2026-09-30',
  rent_start_date: '2026-05-21',
  current_dc_number: 'DC/26-27/0778',
  sales_order_number: 'SO/26-27/0412',
  po_number: 'PO-0004',
  vendor_name: 'Trugrade Supplies',
  acquisition_type: 'rental_purchase',
};

export const ASSET_DOCUMENTS_FIXTURE = [
  { doc: 'PO-0004',       type: 'Purchase Order',   date: '2026-03-28T00:00:00+05:30', amount: 31500, status: 'in_stock' },
  { doc: 'SO/26-27/0412', type: 'Sales Order',      date: '2026-05-18T00:00:00+05:30', amount: 2499,  status: 'reserved' },
  { doc: 'DC/26-27/0778', type: 'Delivery Challan', date: '2026-05-20T00:00:00+05:30', amount: null,  status: 'in_transit' },
  { doc: 'INV-1129',      type: 'Invoice',          date: '2026-06-01T00:00:00+05:30', amount: 2499,  status: 'rented' },
  { doc: 'TKT-3341',      type: 'Support Ticket',   date: '2026-08-14T00:00:00+05:30', amount: null,  status: 'in_repair' },
  { doc: 'CN-0271',       type: 'Credit Note',      date: '2026-09-01T00:00:00+05:30', amount: -1082.9, status: 'rented' },
];
