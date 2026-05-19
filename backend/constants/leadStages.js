/**
 * Lead status ↔ lead stage (reason / substage). Kept in sync with frontend/src/constants/leadStages.js
 */
const STATUSES_WITHOUT_STAGE_CHOICE = ['Deal', 'Call Back', 'Demo'];

const STAGES_BY_STATUS = {
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
    'Need Local Vendor'
  ]
  // Pending: no substages (optional null)
};

function stagesForStatus(status) {
  return STAGES_BY_STATUS[status] || [];
}

function statusRequiresStagePick(status) {
  if (STATUSES_WITHOUT_STAGE_CHOICE.includes(status)) return false;
  const list = stagesForStatus(status);
  return list.length > 0;
}

module.exports = {
  STATUSES_WITHOUT_STAGE_CHOICE,
  STAGES_BY_STATUS,
  stagesForStatus,
  statusRequiresStagePick
};
