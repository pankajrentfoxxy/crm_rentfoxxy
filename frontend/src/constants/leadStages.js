/**
 * Lead status ↔ lead stage. Mirror: backend/constants/leadStages.js
 */
export const STATUSES_WITHOUT_STAGE_CHOICE = ['Call Back', 'Demo', 'Pending'];

export const STAGES_BY_STATUS = {
  Cold: ['Proposal Shared', 'In Follow Up', 'Nurturing'],
  Warm: ['Price Agreed', 'Gst Shared', 'Price Negotiation'],
  Hot: ['Agreement Sent', 'Agreement Review', 'Asked For GST Challan'],
  Gone: ['Taken From Another Vendor', 'Plan Cancelled', 'Need New Laptops'],
  Hold: ['Plan On Hold'],
  Rejected: [
    'No Revenue/Less Revenue',
    'No GST',
    'GST Challan Not Shared',
    'No Reply/Not Picking',
    'New Laptop Needed',
    "Configuration Doesn't Match",
    'Lesser Duration',
    'Comparing the Price',
    'Less Budget',
    'Not Interested/Not Needed',
    'B2C',
    'Looking For Mobiles',
    'Agreement Terms Not Match',
    'Wrong Number/Number Not in Service',
    'Delivery/Support Charges',
    'Enquiry Raised By Mistake',
    'Service Not Feasible',
    'Need Local Vendor',
  ],
  Deal: ['Deal'],
  Repeat: ['Repeat Customer'],
};

export function stagesForStatus(status) {
  return STAGES_BY_STATUS[status] || [];
}

export function statusRequiresStagePick(status) {
  if (STATUSES_WITHOUT_STAGE_CHOICE.includes(status)) return false;
  return (STAGES_BY_STATUS[status] || []).length > 0;
}
