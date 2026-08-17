/** CRM internal roles (excludes portal-only vendor/customer) */
export const CRM_ROLES = [
  'super_admin',
  'admin',
  'manager',
  'sales',
  'floor_manager',
  'team_member',
  'team_lead',
  'qc',
  'procurement',
  'warehouse',
  'dispatch',
  'accounts',
  'support_lead',
  'support_tech',
  'technician',
  'support_agent',
  'support_manager',
  'dispatch_qc',
];

export const MANAGEABLE_ROLES = [
  'team_member', 'team_lead', 'sales', 'floor_manager', 'procurement', 'qc',
  'dispatch', 'manager', 'admin', 'support_lead', 'support_tech', 'technician', 'support_agent',
  'support_manager', 'accounts', 'warehouse',
  'dispatch_qc',
];

export const ROLE_DESCRIPTIONS = {
  super_admin: 'Full unrestricted access. Can manage admins.',
  admin: 'Full access except super_admin actions',
  manager: 'Approvals, reports, team oversight',
  sales: 'Leads, quotations, sales orders, own customers',
  floor_manager: 'Assign tickets, all floor pipeline, inventory',
  team_member: 'Own assigned tickets only, parts requests',
  team_lead: 'Own + team tickets, can log parts',
  qc: 'QC1/QC2 stages only',
  procurement: 'Purchase orders, GRN, vendor management',
  warehouse: 'GRN receive, inventory, DC attachment',
  dispatch: 'Delivery challans, dispatch, delivery register',
  accounts: 'Billing, invoices, e-invoice, credit/debit notes',
  support_lead: 'All support tickets, manage support team',
  support_tech: 'Own assigned support tickets',
  technician: 'Field technician — own jobs in My bucket',
  support_agent: 'Raise and classify tickets. Cannot assign field jobs or approve charges.',
  support_manager: 'Full support operations: assign, approve, administer SLA and taxonomy.',
  dispatch_qc: 'Dispatch QC',
};

export const ROLE_DISPLAY_NAMES = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  sales: 'Sales',
  floor_manager: 'Floor Manager',
  team_member: 'Technician (Floor)',
  team_lead: 'Senior Technician',
  qc: 'QC Inspector',
  procurement: 'Procurement',
  warehouse: 'Warehouse',
  dispatch: 'Dispatch',
  accounts: 'Accounts',
  support_lead: 'Support Lead',
  support_tech: 'Support Technician',
  technician: 'Technician',
  support_agent: 'Support Agent',
  support_manager: 'Support Manager',
  dispatch_qc: 'Dispatch QC',
};

/** Roles that require team assignment */
export const FLOOR_TEAM_ROLES = ['team_member', 'team_lead', 'floor_manager', 'qc'];

export const ROLE_REFERENCE_ROWS = [
  { role: 'super_admin', access: 'Everything', cannot: '—' },
  { role: 'admin', access: 'Everything except billing delete', cannot: '—' },
  { role: 'manager', access: 'Approvals, all views, reports, team mgmt', cannot: 'Delete financial' },
  { role: 'sales', access: 'Leads, customers, quotations, SOs', cannot: 'Floor, billing, vendors' },
  { role: 'floor_manager', access: 'All tickets, assign, floor dashboard', cannot: 'Finance, sales, vendors' },
  { role: 'team_member', access: 'Own tickets only, parts use', cannot: 'Most everything else' },
  { role: 'team_lead', access: 'Team tickets, parts management', cannot: 'Finance, sales' },
  { role: 'qc', access: 'QC1/QC2 stages only', cannot: 'Everything else' },
  { role: 'procurement', access: 'POs, GRN, vendor management, parts', cannot: 'Sales, billing, floor' },
  { role: 'warehouse', access: 'GRN, inventory, DC attach', cannot: 'Sales, billing, finance' },
  { role: 'dispatch', access: 'DCs, delivery register, send', cannot: 'Sales, billing, floor' },
  { role: 'accounts', access: 'All billing, invoices, e-invoice', cannot: 'Floor, sales, vendors' },
  { role: 'support_lead', access: 'All support tickets, team mgmt', cannot: 'Billing, floor, sales' },
  { role: 'support_tech', access: 'Own support tickets', cannot: 'Everything else' },
  { role: 'technician', access: 'Own field jobs in My bucket', cannot: 'Assign others, approve charges' },
  { role: 'support_agent', access: 'Raise and classify tickets', cannot: 'Assign field jobs, approve charges' },
  { role: 'support_manager', access: 'Assign, approve, SLA and taxonomy', cannot: 'Billing, floor, sales' },
  { role: 'dispatch_qc', access: 'Dispatch QC', cannot: 'Everything else' },
];
