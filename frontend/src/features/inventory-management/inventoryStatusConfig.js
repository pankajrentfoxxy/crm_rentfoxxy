/** Laravel inventory-list out_for_repare — repared / replace (ReturnAndRepareCheck) */
export const OUT_FOR_REPAIR_INVENTORY_ACTIONS = [
  { value: 'repared', label: 'Repared' },
  { value: 'replace', label: 'Replace' }
];

/** Laravel inventory-list/passed — status2 sale routing (ReturnAndRepareCheckXYZ) */
export const READY_TO_RENT_SALE_ACTIONS = [
  { value: 'normal_sale', label: 'Normal Sale' },
  { value: 'clearance_sale', label: 'Clearance Sale' },
  { value: 'rent', label: 'Rent Sale' },
  { value: 'rent_or_normal_sale', label: 'Rent or Normal Sale' }
];

/** CRM route segment → Laravel admin.inventory.inventoryList segment */
export const INVENTORY_SEGMENT_BY_ROUTE = {
  'ready-to-rent-or-sell': 'passed',
  'rent-to-own': 'rent_to_own',
  'rental-purchase': 'rental_purchase',
  'direct-purchase': 'direct_purchase',
  'out-for-repare': 'out_for_repare',
  'spare-parts': 'spare_parts'
};

/** Alias used by API client + list table */
export const INVENTORY_API_SEGMENT_BY_ROUTE = INVENTORY_SEGMENT_BY_ROUTE;

export const INVENTORY_PAGE_META = {
  'ready-to-rent-or-sell': {
    title: 'Ready to Rent or Sell',
    erpSegment: 'passed',
    countKey: 'passed',
    description: 'QC passed assets ready for rent or sale (Laravel inventory-list/passed).'
  },
  'rent-to-own': {
    title: 'Rent To Own',
    erpSegment: 'rent_to_own',
    countKey: 'rent_to_own',
    description: 'Rent-to-own purchase order inventory.'
  },
  'rental-purchase': {
    title: 'Rental Purchase',
    erpSegment: 'rental_purchase',
    countKey: 'rental_purchase',
    description: 'Rental purchase PO inventory.'
  },
  'direct-purchase': {
    title: 'Direct Purchase',
    erpSegment: 'direct_purchase',
    countKey: 'direct_purchase',
    description: 'Direct purchase PO inventory.'
  },
  'out-for-repare': {
    title: 'Out For Repare',
    erpSegment: 'out_for_repare',
    countKey: 'out_for_repare',
    description: 'Assets sent out for repair.'
  },
  'spare-parts': {
    title: 'Spare Parts',
    erpSegment: 'spare_parts',
    countKey: 'spare_parts',
    description: 'Spare parts inventory (Laravel spare-parts-l: warehouse, used, dead).'
  },
  'serial-number-status': {
    title: 'Serial Number Status',
    erpSegment: 'serial_number_status',
    description: 'Serial lifecycle / status lookup (Laravel serial-number-status).'
  },
  'universal-search': {
    title: 'Universal Search',
    erpSegment: 'universal_search',
    description: 'Cross-inventory search (Laravel universal-search).'
  },
  'npa-assets': {
    title: 'NPA Assets',
    erpSegment: 'npa',
    countKey: 'npa',
    description: 'Non-performing assets (Laravel npa-assets).'
  }
};

/** Laravel spare-parts-l.blade.php tabs */
export const SPARE_PARTS_TABS = [
  { key: 'warehouse', label: 'Warehouse Parts', status: 'pending' },
  { key: 'used', label: 'Running (Used) Parts', status: 'in_used' },
  { key: 'dead', label: 'Dead Parts', status: 'dead' }
];
