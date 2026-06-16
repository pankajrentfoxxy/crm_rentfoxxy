export const LEAD_STATUSES = [
  'Pending', 'Cold', 'Warm', 'Hot', 'Deal', 'Demo', 'Call Back', 'Hold', 'Gone', 'Rejected', 'Repeat',
];

export const STATUS_COLORS = {
  Pending: { bg: 'bg-gray-100', text: 'text-gray-700' },
  Cold: { bg: 'bg-blue-100', text: 'text-blue-700' },
  Warm: { bg: 'bg-amber-100', text: 'text-amber-700' },
  Hot: { bg: 'bg-orange-100', text: 'text-orange-700' },
  Deal: { bg: 'bg-green-100', text: 'text-green-700' },
  Demo: { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Call Back': { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  Hold: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  Gone: { bg: 'bg-red-100', text: 'text-red-700' },
  Rejected: { bg: 'bg-rose-100', text: 'text-rose-700' },
  Repeat: { bg: 'bg-teal-100', text: 'text-teal-700' },
};

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
  Pending: [],
  'Call Back': [],
  Demo: [],
};

export const STATUSES_WITH_STAGES = Object.entries(STAGES_BY_STATUS)
  .filter(([, stages]) => stages.length > 0)
  .map(([status]) => status);

export const INQUIRY_TYPES = ['rental', 'sales', 'both'];

export const LEAD_SOURCES = [
  'Email', 'Walk-in', 'Reference', 'Website', 'Cold Call', 'LinkedIn',
  'WhatsApp', 'Just Dial', 'IndiaMART', 'Other',
];

export const USE_CASES = ['Work From Office', 'Work From Home', 'Both'];

export const COMPANY_TYPES = [
  'Pvt Ltd', 'LLP', 'Proprietorship', 'Partnership', 'Startup',
  'NGO', 'Government', 'Other',
];

export const LAPTOP_BRANDS = [
  'Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer', 'MSI', 'Samsung', 'Any',
];

export const PROCESSORS = [
  'Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9',
  'AMD Ryzen 3', 'AMD Ryzen 5', 'AMD Ryzen 7', 'Apple M1', 'Apple M2', 'Apple M3',
];

export const GENERATIONS = [
  '6th Gen', '7th Gen', '8th Gen', '9th Gen', '10th Gen',
  '11th Gen', '12th Gen', '13th Gen', '14th Gen',
];

export const RAM_OPTIONS = ['4 GB', '8 GB', '12 GB', '16 GB', '24 GB', '32 GB'];
export const STORAGE_OPTIONS = ['128 GB SSD', '256 GB SSD', '512 GB SSD', '1 TB SSD', '1 TB HDD'];

export const DOC_TYPE_LABELS = {
  gst_certificate: 'GST Certificate',
  pan_card: 'PAN Card',
  agreement: 'Agreement',
  kyc_id: 'KYC ID',
  other: 'Other',
};
