/**
 * Parent umbrella sections vs granular child modules.
 * Child view access requires an explicit grant on the child section — a parent
 * row in role_permissions (e.g. sales_pipeline) must NOT unlock children.
 */

export const SECTION_ALIASES = {
  reports_access: ['reports_access', 'reports'],
  reports: ['reports', 'reports_access'],
  follow_ups: ['follow_ups', 'lead_follow_ups'],
  lead_follow_ups: ['follow_ups', 'lead_follow_ups'],
  sales_orders: ['sales_orders', 'sales_orders_doc'],
  sales_orders_replacement: ['sales_orders_replacement'],
  replacement_so_laptop_qc: ['replacement_so_laptop_qc'],
  so_laptop_qc: ['so_laptop_qc'],
  sales_order_cancel: ['sales_order_cancel'],
  sales_orders_doc: ['sales_orders', 'sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental'],
  sales_orders_sale: ['sales_orders_sale', 'sales_orders_doc', 'sales_orders'],
  sales_orders_rental: ['sales_orders_rental', 'sales_orders_doc', 'sales_orders'],
};

/** Sidebar accordion / module umbrella → granular RBAC sections */
export const MODULE_CHILDREN = {
  sales_pipeline: [
    'sales_quotations',
    'sales_orders_doc',
    'sales_orders_sale',
    'sales_orders_rental',
    'sales_orders_replacement',
    'replacement_so_laptop_qc',
    'so_laptop_qc',
    'sales_order_cancel',
    'delivery_challans',
    'return_dc',
    'delivery_register_management',
    'technician_bucket',
    'technicians_bucket_list',
    'delivery_technicians',
    'delivery_my_deliveries',
    'payment_records',
  ],
  floor_pipeline: ['floor_tickets', 'floor_ticket_config_edit', 'chip_level_repair', 'qc_management', 'dispatch_qc', 'pending_inventory'],
  inventory_management: ['parts', 'parts_inventory', 'parts_detach', 'part_vendor_repair', 'customer_inventory', 'ttspl_history', 'inventory_master_data'],
};

export const ALL_CHILD_SECTIONS = new Set(
  Object.values(MODULE_CHILDREN).flat()
);

export function sectionsToCheck(section) {
  return SECTION_ALIASES[section] || [section];
}

export function isChildModuleSection(section) {
  return ALL_CHILD_SECTIONS.has(section);
}

export function isParentModuleSection(section) {
  return Object.prototype.hasOwnProperty.call(MODULE_CHILDREN, section);
}

export function childSectionsForParent(parentSection) {
  return MODULE_CHILDREN[parentSection] || [];
}

/** Sections that grant entry to /inventory-management/* (umbrella route guard). */
export const INVENTORY_UMBRELLA_SECTIONS = [
  'inventory',
  'inventory_management',
  'inventory_master_data',
  'inventory_asset_movement',
  'parts',
  'parts_inventory',
  'parts_detach',
  'part_vendor_repair',
  'customer_inventory',
  'ttspl_history',
];

/** Sections that grant entry to /floor-pipeline/* (umbrella route guard). */
export const FLOOR_UMBRELLA_SECTIONS = [
  'floor_pipeline',
  'floor_tickets',
  'chip_level_repair',
  'qc_management',
  'dispatch_qc',
  'pending_inventory',
];
