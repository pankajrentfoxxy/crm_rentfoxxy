const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const crypto = require('crypto');
const prisma = require('../prisma/client');
const pool = require('../config/db');
const { ensureResearch } = require('../services/leadResearchService');
const { getNextAutoAssignee, updateAutoAssignConfig } = require('../services/leadAutoAssignService');
const {
  runLeadEmailSync,
  getLeadEmailSyncStatus,
} = require('../services/leadEmailIngestionService');
const { isRestrictedToAssigned } = require('../services/dataScopeService');
const {
  validateFinanceExpoxContactFields,
  applyFinanceExpoxDetails,
} = require('./customerManagementController');

const { STATUSES_WITHOUT_STAGE_CHOICE, STAGES_BY_STATUS, stagesForStatus } = require('../constants/leadStages');

function currentUserId(user) {
  const id = user?.user_id ?? user?.userId;
  return id != null && !Number.isNaN(parseInt(id, 10)) ? parseInt(id, 10) : null;
}

function hasSalesAccess(user) {
  if (!user) return false;
  if (user.role === 'sales') return true;
  return Array.isArray(user.permissions) && user.permissions.includes('sales_access');
}

/** Sales / sales_access users operate on their own lead queue only. */
function isSalesLeadOperator(user) {
  if (!user) return false;
  if (user.role === 'sales') return true;
  if (['admin', 'manager', 'super_admin'].includes(user.role)) return false;
  return hasSalesAccess(user);
}

function sameUserId(a, b) {
  if (a == null || b == null) return false;
  return parseInt(a, 10) === parseInt(b, 10);
}

/** DB `follow_up_time` is TIME — format as HH:mm for API consumers. */
function formatFollowUpTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const h = String(value.getUTCHours()).padStart(2, '0');
    const m = String(value.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const s = String(value).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/** Parse HTML time input / API string into PostgreSQL TIME literal. */
function normalizeFollowUpTimeForDb(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const h = String(value.getUTCHours()).padStart(2, '0');
    const m = String(value.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}:00`;
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
}

function serializeLeadFollowUpTime(lead) {
  if (!lead || lead.followUpTime === undefined) return lead;
  lead.followUpTime = formatFollowUpTime(lead.followUpTime);
  return lead;
}

async function ensureLeadQuotationColumns() {
  await pool.query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS quotation_accept_token VARCHAR(64),
      ADD COLUMN IF NOT EXISTS quotation_accepted_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS quotation_last_sent_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS quotation_last_estimate_no VARCHAR(50),
      ADD COLUMN IF NOT EXISTS quotation_last_to_email VARCHAR(255)
  `);
}

exports.ensureLeadCrmSchema = async () => {
  const files = ['057_phase3_lead_crm.sql'];
  for (const file of files) {
    const sqlPath = path.join(__dirname, '../migrations', file);
    if (fs.existsSync(sqlPath)) {
      await pool.query(fs.readFileSync(sqlPath, 'utf8'));
    }
  }
  await ensureLeadQuotationColumns();
};

async function attachQuotationMeta(lead) {
  await ensureLeadQuotationColumns();
  const qRes = await pool.query(
    `SELECT quotation_accepted_at, quotation_last_sent_at, quotation_last_estimate_no, quotation_last_to_email
     FROM leads WHERE lead_id = $1`,
    [lead.leadId]
  );
  const row = qRes.rows[0] || {};
  lead.quotationAcceptedAt = row.quotation_accepted_at ?? null;
  lead.quotationLastSentAt = row.quotation_last_sent_at ?? null;
  lead.quotationLastEstimateNo = row.quotation_last_estimate_no ?? null;
  lead.quotationLastToEmail = row.quotation_last_to_email ?? null;
  return lead;
}

const LEAD_STATUSES = ['Pending', 'Cold', 'Warm', 'Hot', 'Gone', 'Hold', 'Rejected', 'Call Back', 'Deal', 'Demo', 'Repeat'];
const LEAD_SOURCE_OPTIONS = ['Google', 'LinkedIn', 'Team', 'References', 'Apollo'];

const csvEscape = (value) => {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

/** Shared Prisma where for list + CSV export */
function buildPrismaWhereForLeads(req, { assignedOnly = false } = {}) {
  const { status, assigned_to, source, date_from, date_to, search, include_duplicates } = req.query;
  const andConditions = [];

  if (!include_duplicates || include_duplicates === 'false') {
    andConditions.push({ isDuplicate: false });
  }

  if (status) {
    const statusList = normalizeArrayField(status);
    if (statusList.length > 0 && statusList.length < LEAD_STATUSES.length) {
      andConditions.push({ status: { in: statusList } });
    }
  }

  if (source) {
    const sources = normalizeArrayField(source);
    if (sources.length === 1) {
      andConditions.push({ source: sources[0] });
    } else if (sources.length > 1) {
      if (sources.length < LEAD_SOURCE_OPTIONS.length) {
        andConditions.push({ source: { in: sources } });
      }
    }
  }

  if (assignedOnly) {
    const uid = currentUserId(req.user);
    if (uid != null) {
      andConditions.push({
        OR: [
          { assignedUserId: uid },
          { AND: [{ assignedById: uid }, { assignedUserId: null }] },
        ],
      });
    }
  } else if (assigned_to) {
    const parts = normalizeArrayField(assigned_to);
    if (parts.some((p) => String(p).toLowerCase() === 'me')) {
      const uid = currentUserId(req.user);
      if (uid != null) andConditions.push({ assignedUserId: uid });
    } else {
    const hasUnassigned = parts.some((p) => String(p).toLowerCase() === 'unassigned');
    const userIds = parts
      .filter((p) => String(p).toLowerCase() !== 'unassigned')
      .map((p) => parseInt(String(p).trim(), 10))
      .filter((n) => !Number.isNaN(n));
    if (hasUnassigned && userIds.length > 0) {
      andConditions.push({ OR: [{ assignedUserId: null }, { assignedUserId: { in: userIds } }] });
    } else if (hasUnassigned) {
      andConditions.push({ assignedUserId: null });
    } else if (userIds.length === 1) {
      andConditions.push({ assignedUserId: userIds[0] });
    } else if (userIds.length > 1) {
      andConditions.push({ assignedUserId: { in: userIds } });
    }
    }
  }

  if (date_from || date_to) {
    const createdAtFilter = {};
    if (date_from) createdAtFilter.gte = new Date(`${date_from}T00:00:00.000Z`);
    if (date_to) createdAtFilter.lte = new Date(`${date_to}T23:59:59.999Z`);
    andConditions.push({ createdAt: createdAtFilter });
  }

  if (search) {
    andConditions.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { city: { contains: search, mode: 'insensitive' } }
      ]
    });
  }

  return andConditions.length > 0 ? { AND: andConditions } : {};
}

const normalizeEmail = (value) => (value || '').trim().toLowerCase();
const normalizePhone = (value) => (value || '').replace(/\s+/g, '');
const isLikelyCompanyDomain = (value) => !!value && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
const getDomainFromEmail = (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) return null;
  return normalized.split('@')[1] || null;
};
async function leadsAssignedOnly(req) {
  return isRestrictedToAssigned(req, 'leads');
}

async function denyUnlessCanEditLead(req, res, lead) {
  const assignedOnly = await leadsAssignedOnly(req);
  if (assignedOnly && !canEditLead(req.user, lead, { assignedOnly: true })) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return true;
  }
  return false;
}

const canEditLead = (user, lead, { assignedOnly = false } = {}) => {
  if (!user || !lead) return false;
  if (['admin', 'manager', 'super_admin'].includes(user.role)) return true;
  if (!assignedOnly) return true;
  const uid = currentUserId(user);
  const assignedUserId = lead.assignedUserId ?? lead.assigned_user_id;
  const assignedById = lead.assignedById ?? lead.assigned_by;
  return sameUserId(assignedUserId, uid)
    || (assignedUserId == null && sameUserId(assignedById, uid));
};

const pickField = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
};

const normalizeRowKeys = (row) => {
  const normalized = {};
  Object.keys(row || {}).forEach((key) => {
    const cleanKey = String(key)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    normalized[cleanKey] = row[key];
  });
  return normalized;
};

const buildLeadPayload = (row) => {
  const normalizedRow = normalizeRowKeys(row);
  const name = pickField(row, ['name', 'contact_name', 'lead_name', 'company_name']);
  const companyName = pickField(row, ['company_name', 'company', 'business_name']);
  const email = normalizeEmail(pickField(row, ['email', 'email_id', 'work_email']));
  const phone = normalizePhone(pickField(row, ['phone', 'phone_number', 'mobile', 'mobile_number']));
  const source = pickField(row, ['source', 'lead_source']);
  const city = pickField(row, ['city', 'town', 'location']);

  const normalizedName = pickField(normalizedRow, ['name', 'contact_name', 'lead_name', 'company_name', 'company']);
  const normalizedCompany = pickField(normalizedRow, ['company_name', 'company', 'business_name']);
  const normalizedEmail = normalizeEmail(pickField(normalizedRow, ['email', 'email_id', 'work_email']));
  const normalizedPhone = normalizePhone(pickField(normalizedRow, ['phone', 'phone_number', 'mobile', 'mobile_number']));
  const normalizedSource = pickField(normalizedRow, ['source', 'lead_source']);
  const normalizedCity = pickField(normalizedRow, ['city', 'town', 'location']);

  return {
    name: normalizedName || name || normalizedCompany || companyName || 'Unknown',
    companyBrand: pickField(normalizedRow, ['company_brand', 'company_brand_name']) || pickField(row, ['company_brand', 'company_brand_name']) || null,
    brand: pickField(normalizedRow, ['brand']) || pickField(row, ['brand']) || null,
    companyName: normalizedCompany || companyName || null,
    email: normalizedEmail || email || null,
    phone: normalizedPhone || phone || null,
    city: normalizedCity || city || null,
    source: normalizedSource || source || null
  };
};

const formatHeadOfficeAddress = (research) => {
  const chunks = [
    research?.address,
    research?.city,
    research?.state
  ].map((v) => (v || '').trim()).filter(Boolean);
  return chunks.join(', ');
};

const ensureCustomerFromLead = async (leadId) => {
  const leadRes = await pool.query(
    `SELECT l.lead_id, l.name, l.brand, l.company_name, l.email, l.phone,
            COALESCE(r.gst, l.gst_number) AS gst, r.address, r.city, r.state, r.pincode
     FROM leads l
     LEFT JOIN lead_company_research r ON r.lead_id = l.lead_id
     WHERE l.lead_id = $1`,
    [leadId]
  );
  if (!leadRes.rows.length) return null;
  const lead = leadRes.rows[0];
  const headOffice = formatHeadOfficeAddress(lead) || null;

  const existingCustomer = await pool.query(
    'SELECT customer_id FROM customers WHERE source_lead_id = $1 LIMIT 1',
    [lead.lead_id]
  );

  let customerId;
  if (existingCustomer.rows.length) {
    customerId = existingCustomer.rows[0].customer_id;
    await pool.query(
      `UPDATE customers SET
         name = $1, company_name = $2, email = $3, phone = $4, gst_no = $5, address = $6, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = $7`,
      [
        lead.name || lead.company_name || 'Lead Customer',
        lead.company_name || null,
        lead.email || null,
        lead.phone || null,
        lead.gst || null,
        headOffice,
        customerId,
      ]
    );
  } else {
    const inserted = await pool.query(
      `INSERT INTO customers (name, company_name, source_lead_id, email, phone, gst_no, address, type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Lead', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING customer_id`,
      [
        lead.name || lead.company_name || 'Lead Customer',
        lead.company_name || null,
        lead.lead_id,
        lead.email || null,
        lead.phone || null,
        lead.gst || null,
        headOffice,
      ]
    );
    customerId = inserted.rows[0].customer_id;
  }

  if (headOffice) {
    const billingAddr = await pool.query(
      `SELECT customer_address_id FROM customer_addresses
       WHERE customer_id = $1 AND is_head_office = true LIMIT 1`,
      [customerId]
    );
    if (billingAddr.rows.length) {
      await pool.query(
        `UPDATE customer_addresses SET
           concern_person = $1, mobile_no = $2, address = $3, pincode = $4,
           address_type = 'Billing', updated_at = CURRENT_TIMESTAMP
         WHERE customer_address_id = $5`,
        [lead.name || null, lead.phone || null, headOffice, lead.pincode || null, billingAddr.rows[0].customer_address_id]
      );
    } else {
      await pool.query(
        `INSERT INTO customer_addresses (customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, 'Billing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [customerId, lead.name || null, lead.phone || null, headOffice, lead.pincode || null]
      );
    }
  }

  try {
    await pool.query(
      `INSERT INTO customer_addresses (customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type, source_lead_address_id, created_at, updated_at)
       SELECT $1, la.concern_person, la.mobile_no, la.address, la.pincode, false, COALESCE(la.address_type, 'Shipping'), la.address_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       FROM lead_addresses la
       WHERE la.lead_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM customer_addresses ca WHERE ca.source_lead_address_id = la.address_id
         )`,
      [customerId, leadId]
    );
  } catch (addrErr) {
    if (addrErr.code !== '42703') throw addrErr;
  }

  return customerId;
};

const shuffle = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const distributeAssignments = (leadIds, userIds) => {
  if (!leadIds.length || !userIds.length) return [];
  const randomizedUsers = shuffle(userIds);
  return leadIds.map((leadId, index) => ({
    leadId,
    assignedTo: randomizedUsers[index % randomizedUsers.length]
  }));
};

const normalizeArrayField = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

async function enrichLeadsPhase3(leads) {
  if (!leads?.length) return leads;
  const ids = leads.map((l) => l.leadId);
  try {
    const { rows } = await pool.query(
      `SELECT lead_id, whatsapp_number, designation, quantity_required, monthly_budget,
              rental_duration, use_case, company_type, company_size, industry, annual_revenue,
              pan_number, gst_number, state, pincode, billing_address, shipping_same_as_billing,
              shipping_address, follow_up_time, converted_at, converted_by, customer_id,
              inquiry_type, last_activity_at
       FROM leads WHERE lead_id = ANY($1::int[])`,
      [ids]
    );
    const map = new Map(rows.map((r) => [r.lead_id, r]));
    return leads.map((lead) => {
      const ex = map.get(lead.leadId);
      if (!ex) return lead;
      return {
        ...lead,
        whatsappNumber: ex.whatsapp_number,
        designation: ex.designation,
        quantityRequired: ex.quantity_required,
        monthlyBudget: ex.monthly_budget,
        rentalDuration: ex.rental_duration,
        useCase: ex.use_case,
        companyType: ex.company_type,
        companySize: ex.company_size,
        industry: ex.industry,
        annualRevenue: ex.annual_revenue,
        panNumber: ex.pan_number,
        gstNumber: ex.gst_number,
        state: ex.state,
        pincode: ex.pincode,
        billingAddress: ex.billing_address,
        shippingSameAsBilling: ex.shipping_same_as_billing,
        shippingAddress: ex.shipping_address,
        followUpTime: formatFollowUpTime(ex.follow_up_time),
        convertedAt: ex.converted_at,
        convertedBy: ex.converted_by,
        customerId: ex.customer_id,
        inquiryType: ex.inquiry_type,
        lastActivityAt: ex.last_activity_at
      };
    });
  } catch (e) {
    console.warn('enrichLeadsPhase3 skipped:', e.message);
    return leads;
  }
}

function applyLeadListFilters(leads, req) {
  let out = leads;
  const { inquiry_type, follow_up } = req.query;
  if (inquiry_type) {
    const types = normalizeArrayField(inquiry_type);
    out = out.filter((l) => types.includes(l.inquiryType || 'rental'));
  }
  if (follow_up) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const filter = String(follow_up).toLowerCase();
    out = out.filter((l) => {
      if (!l.followUpDate) return false;
      const fd = new Date(l.followUpDate);
      if (filter === 'today') return fd >= startOfDay && fd <= endOfDay;
      if (filter === 'overdue') return fd < startOfDay;
      if (filter === 'this_week') {
        const startOfWeek = new Date(startOfDay);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
        return fd >= startOfWeek && fd <= endOfWeek;
      }
      return true;
    });
  }
  return out;
}

exports.getLeads = async (req, res) => {
  try {
    const assignedOnly = await leadsAssignedOnly(req);
    const where = buildPrismaWhereForLeads(req, { assignedOnly });

    let leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        assignedUser: { select: { userId: true, name: true, role: true } },
        research: true
      }
    });

    leads = await enrichLeadsPhase3(leads);
    leads = applyLeadListFilters(leads, req);

    res.json({ success: true, count: leads.length, leads });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching leads' });
  }
};

exports.exportLeadsCsv = async (req, res) => {
  try {
    const assignedOnly = await leadsAssignedOnly(req);
    const where = buildPrismaWhereForLeads(req, { assignedOnly });
    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        assignedUser: { select: { name: true } }
      }
    });

    const ids = leads.map((l) => l.leadId);
    const remarkRows =
      ids.length === 0
        ? { rows: [] }
        : await pool.query(
            `SELECT r.lead_id, r.note, r.created_at, u.name AS actor
             FROM lead_remarks r
             LEFT JOIN users u ON r.user_id = u.user_id
             WHERE r.lead_id = ANY($1::int[])`,
            [ids]
          );
    const activityRows =
      ids.length === 0
        ? { rows: [] }
        : await pool.query(
            `SELECT a.lead_id, a.action, a.status_to, a.notes, a.created_at, u.name AS actor
             FROM lead_activities a
             LEFT JOIN users u ON a.user_id = u.user_id
             WHERE a.lead_id = ANY($1::int[])`,
            [ids]
          );

    const timelineByLead = new Map();
    const pushEvent = (leadId, createdAt, line, actor) => {
      if (!timelineByLead.has(leadId)) timelineByLead.set(leadId, []);
      timelineByLead.get(leadId).push({ createdAt: new Date(createdAt), line, actor: actor || '' });
    };
    for (const r of remarkRows.rows || []) {
      pushEvent(r.lead_id, r.created_at, `Remark: ${String(r.note || '').replace(/\s+/g, ' ')}`, r.actor);
    }
    for (const a of activityRows.rows || []) {
      const parts = [a.action, a.status_to, a.notes].filter(Boolean).join(' — ');
      pushEvent(a.lead_id, a.created_at, parts || 'Activity', a.actor);
    }
    const formatLast10 = (leadId) => {
      const evs = timelineByLead.get(leadId) || [];
      evs.sort((x, y) => y.createdAt - x.createdAt);
      return evs
        .slice(0, 10)
        .map((e) => {
          const d = Number.isNaN(e.createdAt.getTime()) ? '' : e.createdAt.toISOString().slice(0, 19).replace('T', ' ');
          return `${d} | ${e.actor}: ${e.line}`;
        })
        .join('\n');
    };

    const header = [
      'Date',
      'Name',
      'Email',
      'Phone',
      'Company name',
      'Source',
      'Status',
      'Lead stage',
      'Assignee',
      'Personal remarks',
      'Last 10 remarks / activities'
    ];
    const lines = [header.map(csvEscape).join(',')];
    for (const lead of leads) {
      const row = [
        lead.createdAt ? new Date(lead.createdAt).toISOString().slice(0, 10) : '',
        lead.name,
        lead.email,
        lead.phone,
        lead.companyName,
        lead.source,
        lead.status,
        lead.leadStage || '',
        lead.assignedUser?.name || '',
        lead.personalRemarks || '',
        formatLast10(lead.leadId)
      ];
      lines.push(row.map(csvEscape).join(','));
    }

    const csv = '\ufeff' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads-export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Export leads CSV error:', error);
    res.status(500).json({ success: false, message: 'Server error exporting leads' });
  }
};

exports.getLeadById = async (req, res) => {
  const { id } = req.params;

  try {
    const lead = await prisma.lead.findUnique({
      where: { leadId: parseInt(id, 10) },
      include: {
        assignedUser: { select: { userId: true, name: true, role: true } },
        research: true,
        activities: {
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { userId: true, name: true } }
          }
        },
        assignments: { orderBy: { assignedAt: 'desc' } },
        orders: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (await denyUnlessCanEditLead(req, res, lead)) return;

    const addressRes = await pool.query(
      `SELECT address_id, concern_person, mobile_no, address, pincode, address_type, created_at
       FROM lead_addresses
       WHERE lead_id = $1
       ORDER BY created_at DESC`,
      [lead.leadId]
    );
    lead.addresses = addressRes.rows;

    const remarksRes = await pool.query(
      `SELECT r.remark_id, r.lead_id, r.user_id, r.note, r.created_at, u.name as user_name
       FROM lead_remarks r
       LEFT JOIN users u ON r.user_id = u.user_id
       WHERE r.lead_id = $1
       ORDER BY r.created_at DESC`,
      [lead.leadId]
    );
    lead.remarks = remarksRes.rows.map((row) => ({
      remarkId: row.remark_id,
      leadId: row.lead_id,
      userId: row.user_id,
      note: row.note,
      createdAt: row.created_at,
      userName: row.user_name
    }));

    // Exclude email_reingested from activities (only show post-ingestion activity)
    lead.activities = (lead.activities || []).filter(
      (a) => a.action !== 'email_reingested'
    );

    // Ensure personalRemarks is present (fallback if Prisma client is out of sync)
    if (lead.personalRemarks === undefined && lead.personal_remarks === undefined) {
      const prRes = await pool.query('SELECT personal_remarks FROM leads WHERE lead_id = $1', [lead.leadId]);
      lead.personalRemarks = prRes.rows[0]?.personal_remarks ?? null;
    } else if (lead.personalRemarks === undefined) {
      lead.personalRemarks = lead.personal_remarks;
    }

    const [enriched] = await enrichLeadsPhase3([lead]);
    Object.assign(lead, enriched);

    await attachQuotationMeta(lead);

    res.json({ success: true, lead });
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching lead' });
  }
};

exports.getQuotationAcceptPreview = async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) {
    return res.status(400).json({ success: false, message: 'Invalid link' });
  }
  try {
    await ensureLeadQuotationColumns();
    const qRes = await pool.query(
      `SELECT lead_id, company_name, name, quotation_last_estimate_no, quotation_accepted_at, quotation_last_sent_at
       FROM leads WHERE quotation_accept_token = $1 LIMIT 1`,
      [token]
    );
    const row = qRes.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, message: 'Quotation link is invalid or expired' });
    }
    res.json({
      success: true,
      company_name: row.company_name || row.name || 'Customer',
      estimate_no: row.quotation_last_estimate_no || null,
      accepted_at: row.quotation_accepted_at,
      sent_at: row.quotation_last_sent_at
    });
  } catch (error) {
    console.error('Quotation preview error:', error);
    res.status(500).json({ success: false, message: 'Unable to load quotation' });
  }
};

exports.acceptLeadQuotation = async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) {
    return res.status(400).json({ success: false, message: 'Invalid link' });
  }
  try {
    await ensureLeadQuotationColumns();
    const qRes = await pool.query(
      `SELECT lead_id, company_name, name, email, quotation_last_estimate_no, quotation_last_to_email,
              quotation_accepted_at, assigned_user_id
       FROM leads WHERE quotation_accept_token = $1 LIMIT 1`,
      [token]
    );
    const row = qRes.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, message: 'Quotation link is invalid or expired' });
    }

    const estimateNo = row.quotation_last_estimate_no || 'Quotation';
    const companyName = row.company_name || row.name || 'Customer';
    const toEmail = String(row.quotation_last_to_email || row.email || '')
      .trim()
      .toLowerCase();

    if (row.quotation_accepted_at) {
      return res.json({
        success: true,
        already_accepted: true,
        message: 'This quotation was already accepted.',
        estimate_no: estimateNo,
        company_name: companyName,
        accepted_at: row.quotation_accepted_at
      });
    }

    const acceptRes = await pool.query(
      `UPDATE leads SET quotation_accepted_at = NOW()
       WHERE lead_id = $1 AND quotation_accept_token = $2 AND quotation_accepted_at IS NULL
       RETURNING quotation_accepted_at`,
      [row.lead_id, token]
    );
    if (!acceptRes.rows[0]) {
      return res.json({
        success: true,
        already_accepted: true,
        message: 'This quotation was already accepted.',
        estimate_no: estimateNo,
        company_name: companyName
      });
    }

    let senderEmail = '';
    let senderName = '';
    if (row.assigned_user_id) {
      const ures = await pool.query('SELECT name, email FROM users WHERE user_id = $1', [row.assigned_user_id]);
      senderEmail = String(ures.rows[0]?.email || '').trim();
      senderName = ures.rows[0]?.name || '';
    }

    const { sendQuotationAcceptedEmail } = require('../services/leadQuotationService');
    if (toEmail) {
      try {
        await sendQuotationAcceptedEmail({
          toEmail,
          companyName,
          estimateNo,
          senderEmail,
          senderName
        });
      } catch (mailErr) {
        console.error('Quotation accepted email failed:', mailErr);
      }
    }

    try {
      await prisma.leadActivity.create({
        data: {
          leadId: row.lead_id,
          userId: row.assigned_user_id || null,
          action: 'quotation_accepted',
          notes: `${estimateNo} accepted by customer${toEmail ? ` (${toEmail})` : ''}`
        }
      });
    } catch (logErr) {
      console.error('Lead activity log failed after quotation accepted:', logErr);
    }

    res.json({
      success: true,
      message: 'Thank you — your acceptance has been recorded.',
      estimate_no: estimateNo,
      company_name: companyName,
      accepted_at: acceptRes.rows[0].quotation_accepted_at
    });
  } catch (error) {
    console.error('Accept quotation error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to record acceptance' });
  }
};

exports.createLead = async (req, res) => {
  const payload = buildLeadPayload(req.body || {});

  if (!payload.phone || !String(payload.phone).trim()) {
    return res.status(400).json({ success: false, message: 'Phone is required' });
  }

  try {
    let duplicateOf = null;
    if (payload.email && payload.phone) {
      const existing = await prisma.lead.findFirst({
        where: { email: payload.email, phone: payload.phone, isDuplicate: false }
      });
      if (existing) duplicateOf = existing.leadId;
    }

    const uid = currentUserId(req.user);
    let assignData = {};
    if (isSalesLeadOperator(req.user) && uid) {
      assignData = { assignedUserId: uid, assignedById: uid, assignedAt: new Date() };
    } else {
      let autoAssignee = null;
      try {
        autoAssignee = await getNextAutoAssignee();
      } catch (assignErr) {
        console.error('Auto-assign lookup failed:', assignErr.message);
      }
      if (autoAssignee) {
        assignData = { assignedUserId: autoAssignee, assignedById: uid, assignedAt: new Date() };
      }
    }

    const body = req.body || {};
    const personalRemarks = body.personal_remarks ?? body.personalRemarks;
    const inquiryType = body.inquiry_type ?? body.inquiryType ?? 'rental';
    const normalizedInquiry = ['rental', 'sales', 'both'].includes(inquiryType) ? inquiryType : 'rental';

    const lead = await prisma.lead.create({
      data: {
        ...payload,
        companyBrand: payload.companyBrand || null,
        brand: payload.brand || null,
        processor: body.processor || null,
        generation: body.generation || null,
        ram: body.ram || null,
        storage: body.storage || null,
        personalRemarks: personalRemarks ? String(personalRemarks).trim() : null,
        status: 'Pending',
        createdAt: new Date(),
        ...assignData,
        isDuplicate: !!duplicateOf,
        duplicateOf: duplicateOf || null
      }
    });

    // Persist assignee via SQL — some deployed Prisma clients fail to write
    // assigned_user_id on create even when assigned_by is set.
    if (assignData.assignedUserId) {
      await pool.query(
        `UPDATE leads
            SET assigned_user_id = $1,
                assigned_by = COALESCE($2, assigned_by),
                assigned_at = COALESCE(assigned_at, NOW())
          WHERE lead_id = $3`,
        [assignData.assignedUserId, assignData.assignedById || uid, lead.leadId]
      );
      lead.assignedUserId = assignData.assignedUserId;
      lead.assignedById = assignData.assignedById || uid;
    }

    await pool.query('UPDATE leads SET inquiry_type = $1 WHERE lead_id = $2', [normalizedInquiry, lead.leadId]);
    lead.inquiryType = normalizedInquiry;

    await prisma.leadActivity.create({
      data: {
        leadId: lead.leadId,
        userId: uid,
        action: 'lead_created',
        notes: 'Lead created'
      }
    });

    if (assignData.assignedUserId) {
      await prisma.leadAssignment.create({
        data: {
          leadId: lead.leadId,
          assignedTo: assignData.assignedUserId,
          assignedBy: assignData.assignedById || uid,
          assignedAt: assignData.assignedAt || new Date()
        }
      }).catch((err) => console.warn('lead_assignment insert skipped:', err.message));
    }

    // Trigger research in background (don't block response)
    ensureResearch(lead).catch((err) => console.error('Lead research error:', err));

    res.status(201).json({ success: true, lead });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error creating lead' });
  }
};

exports.uploadLeadsCsv = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

  const rows = [];
  const errors = [];
  let created = 0;
  let duplicates = 0;

  const firstLine = fs.readFileSync(req.file.path, 'utf8').split(/\r?\n/)[0] || '';
  const separator = firstLine.includes('\t') ? '\t' : ',';

  fs.createReadStream(req.file.path)
    .pipe(csv({ separator }))
    .on('data', (row) => rows.push(row))
    .on('error', (err) => {
      console.error('CSV parse error:', err);
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Invalid CSV format' });
    })
    .on('end', async () => {
      fs.unlinkSync(req.file.path);

      for (const row of rows) {
        try {
          const payload = buildLeadPayload(row);
          if (!payload.name) {
            errors.push({ row, message: 'Missing name or company' });
            continue;
          }

          let duplicateOf = null;
          if (payload.email && payload.phone) {
            const existing = await prisma.lead.findFirst({
              where: { email: payload.email, phone: payload.phone, isDuplicate: false }
            });
            if (existing) duplicateOf = existing.leadId;
          }

          const autoAssignee = await getNextAutoAssignee();
          const assignData = autoAssignee
            ? { assignedUserId: autoAssignee, assignedById: req.user.user_id, assignedAt: new Date() }
            : {};

          const createdLead = await prisma.lead.create({
            data: {
              ...payload,
              status: 'Pending',
              createdAt: new Date(),
              isDuplicate: !!duplicateOf,
              duplicateOf: duplicateOf || null,
              ...assignData
            }
          });

          if (duplicateOf) duplicates += 1;
          created += 1;

          // Trigger research in background
          ensureResearch(createdLead).catch((err) => console.error('Lead research error:', err));
        } catch (error) {
          errors.push({ row, message: error.message });
        }
      }

      try {
        await pool.query(
          `INSERT INTO lead_import_logs (imported_by, total_rows, imported, duplicates, errors, error_details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.user.user_id, rows.length, created, duplicates, errors.length, JSON.stringify(errors.slice(0, 50))]
        );
      } catch (logErr) {
        console.error('lead_import_logs insert failed:', logErr);
      }

      res.json({
        success: true,
        message: `Processed ${rows.length} rows. Created: ${created}. Duplicates: ${duplicates}. Errors: ${errors.length}.`,
        errors: errors.length ? errors : undefined
      });
    });
};

exports.getSampleCsv = async (req, res) => {
  const header = 'name,company_name,email,phone,city,source';
  const sample = [
    'Amit Sharma,Rentfoxxy India,amit@rentfoxxy.com,9876543210,Bengaluru,LinkedIn',
    'Neha Verma,TechNova Pvt Ltd,neha@technova.com,9123456780,Mumbai,Website'
  ];
  const csvContent = [header, ...sample].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="lead_sample.csv"');
  res.send(csvContent);
};

exports.getAssignableSalesUsers = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email, role
         FROM users
        WHERE role = 'sales'
          AND active = true
          AND COALESCE(status, 'active') = 'active'
        ORDER BY name ASC`
    );
    res.json({ success: true, users: rows });
  } catch (error) {
    console.error('getAssignableSalesUsers error:', error);
    res.status(500).json({ success: false, message: 'Failed to load assignable users' });
  }
};

exports.assignLeads = async (req, res) => {
  const { lead_ids, sales_user_id, sales_user_ids, assign_unassigned_only } = req.body;

  try {
    let targetLeadIds = [];
    if (assign_unassigned_only) {
      const unassigned = await prisma.lead.findMany({
        where: { assignedUserId: null },
        select: { leadId: true },
        orderBy: { createdAt: 'asc' }
      });
      targetLeadIds = unassigned.map((l) => l.leadId);
    } else if (Array.isArray(lead_ids) && lead_ids.length > 0) {
      targetLeadIds = lead_ids.map((id) => parseInt(id, 10)).filter(Number.isFinite);
    }

    if (!targetLeadIds.length) {
      return res.status(400).json({ success: false, message: 'No leads available for assignment' });
    }

    const requestedUserIds = Array.isArray(sales_user_ids) && sales_user_ids.length > 0
      ? sales_user_ids.map((id) => parseInt(id, 10)).filter(Number.isFinite)
      : (sales_user_id ? [parseInt(sales_user_id, 10)] : []);

    if (!requestedUserIds.length) {
      return res.status(400).json({ success: false, message: 'At least one sales user is required' });
    }

    const eligibleUsers = await prisma.user.findMany({
      where: {
        userId: { in: requestedUserIds },
        role: 'sales'
      },
      select: { userId: true }
    });
    const eligibleUserIds = eligibleUsers.map((u) => u.userId);
    if (!eligibleUserIds.length) {
      return res.status(400).json({ success: false, message: 'No valid sales users selected' });
    }

    const assignmentPlan = distributeAssignments(targetLeadIds, eligibleUserIds);
    const batchId = crypto.randomUUID();
    const now = new Date();

    await prisma.$transaction(assignmentPlan.map(({ leadId, assignedTo }) =>
      prisma.lead.update({
        where: { leadId },
        data: {
          assignedUserId: assignedTo,
          assignedById: req.user.user_id,
          assignedAt: now
        }
      })
    ));

    await prisma.leadAssignment.createMany({
      data: assignmentPlan.map(({ leadId, assignedTo }) => ({
        leadId,
        assignedTo,
        assignedBy: req.user.user_id,
        assignedAt: now,
        batchId
      }))
    });

    if (assign_unassigned_only && eligibleUserIds.length) {
      await updateAutoAssignConfig(eligibleUserIds, req.user.user_id);
    }

    const leads = await prisma.lead.findMany({
      where: { leadId: { in: targetLeadIds } }
    });

    for (const lead of leads) {
      await ensureResearch(lead);
    }

    const distribution = assignmentPlan.reduce((acc, item) => {
      acc[item.assignedTo] = (acc[item.assignedTo] || 0) + 1;
      return acc;
    }, {});

    const msg = assign_unassigned_only
      ? `${assignmentPlan.length} unassigned leads distributed. Future leads (manual, upload, email) will also be auto-assigned to the selected users.`
      : 'Leads assigned successfully';

    res.json({
      success: true,
      message: msg,
      batch_id: batchId,
      total_assigned: assignmentPlan.length,
      distribution
    });
  } catch (error) {
    console.error('Assign leads error:', error);
    res.status(500).json({ success: false, message: 'Server error assigning leads' });
  }
};

function normalizeGstin(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function isValidIndianGstin(value) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(normalizeGstin(value));
}

function resolveLeadGstin({ gst, gstNumber, researchGst, leadGstNumber }) {
  const candidates = [gst, gstNumber, researchGst, leadGstNumber];
  for (const candidate of candidates) {
    if (candidate == null || String(candidate).trim() === '') continue;
    const normalized = normalizeGstin(candidate);
    if (isValidIndianGstin(normalized)) return normalized;
  }
  return null;
}

exports.updateLeadStatus = async (req, res) => {
  const { id } = req.params;
  const {
    status,
    rejection_reason,
    notes,
    lead_stage,
    brand,
    processor,
    generation,
    ram,
    storage,
    gst: gstInput,
    gst_number: gstNumberInput,
  } = req.body;

  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid lead status' });
  }

  try {
    const lead = await prisma.lead.findUnique({
      where: { leadId: parseInt(id, 10) },
      include: { research: true }
    });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    if (await denyUnlessCanEditLead(req, res, lead)) return;

    let resolvedStage = null;
    if (STATUSES_WITHOUT_STAGE_CHOICE.includes(status)) {
      resolvedStage = status;
    } else {
      const allowed = stagesForStatus(status);
      if (allowed.length > 0) {
        const pick =
          lead_stage != null && String(lead_stage).trim()
            ? String(lead_stage).trim()
            : status === 'Rejected' && rejection_reason
              ? String(rejection_reason).trim()
              : '';
        if (!pick || !allowed.includes(pick)) {
          return res.status(400).json({
            success: false,
            message: `Select a valid lead stage for status "${status}"`
          });
        }
        resolvedStage = pick;
      } else if (lead_stage != null && String(lead_stage).trim()) {
        resolvedStage = String(lead_stage).trim();
      }
    }

    const rejectionReasonDb = status === 'Rejected' ? resolvedStage : null;

    if (status === 'Deal' || status === 'Demo') {
      const resolvedGst = resolveLeadGstin({
        gst: gstInput,
        gstNumber: gstNumberInput,
        researchGst: lead.research?.gst,
        leadGstNumber: lead.gstNumber,
      });
      if (!resolvedGst) {
        const hasAnyGst = [gstInput, gstNumberInput, lead.research?.gst, lead.gstNumber].some(
          (v) => v != null && String(v).trim() !== ''
        );
        if (hasAnyGst) {
          return res.status(400).json({
            success: false,
            message: 'Invalid GSTIN format (15-character GSTIN required).',
          });
        }
        return res.status(400).json({
          success: false,
          message:
            'GSTIN is mandatory for Deal or Demo. Add a valid GST on the lead profile (Company Info) before updating status.',
        });
      }
      await prisma.leadCompanyResearch.upsert({
        where: { leadId: lead.leadId },
        create: { leadId: lead.leadId, gst: resolvedGst },
        update: { gst: resolvedGst }
      });
    }

    const configData = {};
    if (brand !== undefined) configData.brand = String(brand || '').trim() || null;
    if (processor !== undefined) configData.processor = String(processor || '').trim() || null;
    if (generation !== undefined) configData.generation = String(generation || '').trim() || null;
    if (ram !== undefined) configData.ram = String(ram || '').trim() || null;
    if (storage !== undefined) configData.storage = String(storage || '').trim() || null;

    const updated = await prisma.lead.update({
      where: { leadId: lead.leadId },
      data: {
        status,
        leadStage: resolvedStage,
        rejectionReason: rejectionReasonDb,
        ...configData
      }
    });

    await prisma.leadActivity.create({
      data: {
        leadId: lead.leadId,
        userId: req.user.user_id,
        action: 'status_updated',
        statusFrom: lead.status,
        statusTo: status,
        stageFrom: lead.leadStage ?? null,
        stageTo: resolvedStage,
        notes: notes || null
      }
    });

    if (status === 'Deal' || status === 'Demo') {
      await ensureCustomerFromLead(lead.leadId);
    }

    res.json({ success: true, lead: updated });
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({ success: false, message: 'Server error updating status' });
  }
};

exports.updateFollowUp = async (req, res) => {
  const { id } = req.params;
  const { follow_up_date, notes } = req.body;

  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (await denyUnlessCanEditLead(req, res, lead)) return;

    const leadId = parseInt(id, 10);
    const followUpTime = normalizeFollowUpTimeForDb(req.body.follow_up_time);

    await pool.query(
      `UPDATE leads SET
        follow_up_date = $1,
        follow_up_time = $2::time,
        updated_at = NOW()
       WHERE lead_id = $3`,
      [follow_up_date ? new Date(follow_up_date) : null, followUpTime, leadId]
    );

    const updated = await prisma.lead.findUnique({ where: { leadId } });
    serializeLeadFollowUpTime(updated);

    const timeNote = followUpTime ? ` at ${followUpTime}` : '';
    await prisma.leadActivity.create({
      data: {
        leadId: updated.leadId,
        userId: req.user.user_id,
        action: 'follow_up_set',
        notes: notes || `Follow-up scheduled for ${follow_up_date || '—'}${timeNote}`
      }
    });

    res.json({ success: true, lead: updated });
  } catch (error) {
    console.error('Update follow-up error:', error);
    res.status(500).json({ success: false, message: 'Server error updating follow-up' });
  }
};

exports.getFollowUps = async (req, res) => {
  try {
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const assignedOnly = await leadsAssignedOnly(req);
    const uid = currentUserId(req.user);
    const baseWhere = assignedOnly && uid != null ? { assignedUserId: uid } : {};

    const overdue = await prisma.lead.findMany({
      where: {
        ...baseWhere,
        followUpDate: { lt: now },
        status: { notIn: ['Rejected', 'Gone'] }
      },
      orderBy: { followUpDate: 'asc' },
      include: { assignedUser: { select: { userId: true, name: true } } }
    });

    const todayLeads = await prisma.lead.findMany({
      where: {
        ...baseWhere,
        followUpDate: { gte: now, lte: endOfDay },
        status: { notIn: ['Rejected', 'Gone'] }
      },
      orderBy: { followUpDate: 'asc' },
      include: { assignedUser: { select: { userId: true, name: true } } }
    });

    res.json({ success: true, today: todayLeads, overdue });
  } catch (error) {
    console.error('Follow-up error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching follow-ups' });
  }
};

exports.runResearch = async (req, res) => {
  const { id } = req.params;

  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (await denyUnlessCanEditLead(req, res, lead)) return;

    // Force refresh so API re-searches and updates all research fields
    await ensureResearch(lead, { force: true });
    const research = await prisma.leadCompanyResearch.findUnique({ where: { leadId: lead.leadId } });

    res.json({ success: true, research });
  } catch (error) {
    console.error('Research error:', error);
    res.status(500).json({ success: false, message: 'Server error running research' });
  }
};

exports.updateResearchDetails = async (req, res) => {
  const { id } = req.params;

  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (await denyUnlessCanEditLead(req, res, lead)) return;

    const existing = await prisma.leadCompanyResearch.findUnique({
      where: { leadId: lead.leadId }
    });
    const existingRaw = (existing?.rawResponse && typeof existing.rawResponse === 'object') ? existing.rawResponse : {};

    const payload = {
      industry: req.body.industry ?? existing?.industry ?? null,
      pincode: req.body.pincode ?? existingRaw.pincode ?? null,
      cin: req.body.cin ?? existing?.cin ?? null,
      entityType: req.body.entity_type ?? req.body.entityType ?? existing?.entityType ?? null,
      roc: req.body.roc ?? existing?.roc ?? null,
      revenue: req.body.revenue ?? req.body.annual_revenue ?? existing?.revenue ?? null,
      employees: req.body.employees ?? existing?.employees ?? null,
      gst: req.body.gst ?? existing?.gst ?? null,
      address: req.body.address ?? existing?.address ?? null,
      city: req.body.city ?? existing?.city ?? null,
      state: req.body.state ?? existing?.state ?? null
    };

    const mergedRaw = {
      ...existingRaw,
      ...(req.body || {}),
      departments: normalizeArrayField(req.body.departments ?? existingRaw.departments),
      technologies: normalizeArrayField(req.body.technologies ?? existingRaw.technologies)
    };

    const research = await prisma.leadCompanyResearch.upsert({
      where: { leadId: lead.leadId },
      create: {
        leadId: lead.leadId,
        ...payload,
        rawResponse: mergedRaw
      },
      update: {
        ...payload,
        rawResponse: mergedRaw
      }
    });

    await prisma.leadActivity.create({
      data: {
        leadId: lead.leadId,
        userId: req.user.user_id,
        action: 'research_updated',
        notes: 'Company research details updated manually'
      }
    });

    res.json({ success: true, research });
  } catch (error) {
    console.error('Update research details error:', error);
    res.status(500).json({ success: false, message: 'Server error updating company research' });
  }
};

exports.createLeadOrder = async (req, res) => {
  const { id } = req.params;
  const { amount, details, order_status } = req.body;

  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    if (lead.status !== 'Deal') {
      return res.status(400).json({ success: false, message: 'Order can be created only for Deal status' });
    }
    if (await denyUnlessCanEditLead(req, res, lead)) return;

    const order = await prisma.leadOrder.create({
      data: {
        leadId: lead.leadId,
        amount: amount || 0,
        orderStatus: order_status || 'New',
        details: details || null,
        createdBy: req.user.user_id
      }
    });

    await prisma.leadActivity.create({
      data: {
        leadId: lead.leadId,
        userId: req.user.user_id,
        action: 'order_created',
        notes: `Order ${order.leadOrderId} created`
      }
    });

    res.json({ success: true, order });
  } catch (error) {
    console.error('Create lead order error:', error);
    res.status(500).json({ success: false, message: 'Server error creating order' });
  }
};

exports.updateLeadBasicDetails = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    company_name,
    companyName,
    company_brand,
    companyBrand,
    email,
    phone,
    city,
    personal_remarks,
    personalRemarks
  } = req.body || {};

  try {
    const leadId = parseInt(id, 10);
    const existing = await prisma.lead.findUnique({ where: { leadId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canEditLead(req.user, existing)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const normalizedCity = city !== undefined ? String(city || '').trim() : undefined;
    const nextCompanyName = (company_name ?? companyName ?? existing.companyName ?? null);
    const nextCompanyBrand = (company_brand ?? companyBrand) !== undefined
      ? String(company_brand ?? companyBrand ?? '').trim() || null
      : undefined;
    const nextPersonalRemarks = (personal_remarks ?? personalRemarks) !== undefined
      ? String(personal_remarks ?? personalRemarks ?? '').trim() || null
      : undefined;

    // Use raw SQL for full update to avoid Prisma client sync issues with company_brand
    // Only update email/phone if explicitly provided - otherwise keep existing (fixes bug when only personal_remarks is sent)
    const nextName = (name ?? existing.name)?.trim() || existing.name;
    const nextEmail = email !== undefined ? (normalizeEmail(email) || null) : existing.email;
    const nextPhone = phone !== undefined ? (normalizePhone(phone) || null) : existing.phone;
    const nextCity = normalizedCity !== undefined ? (normalizedCity || null) : existing.city;
    const nextPersonalRemarksVal = nextPersonalRemarks !== undefined ? nextPersonalRemarks : (existing.personalRemarks ?? existing.personal_remarks);
    const cbRes = await pool.query('SELECT company_brand FROM leads WHERE lead_id = $1', [leadId]);
    const existingCompanyBrandVal = cbRes.rows[0]?.company_brand ?? null;
    const nextCompanyBrandVal = nextCompanyBrand !== undefined ? nextCompanyBrand : existingCompanyBrandVal;

    await pool.query(
      `UPDATE leads SET
        name = $1, company_name = $2, company_brand = $3, email = $4, phone = $5, city = $6, personal_remarks = $7, updated_at = NOW()
       WHERE lead_id = $8`,
      [nextName, nextCompanyName, nextCompanyBrandVal, nextEmail, nextPhone, nextCity, nextPersonalRemarksVal, leadId]
    );

    const updated = await prisma.lead.findUnique({
      where: { leadId },
      include: { assignedUser: { select: { userId: true, name: true, role: true } } }
    });

    await prisma.leadActivity.create({
      data: {
        leadId,
        userId: req.user.user_id,
        action: 'lead_basic_updated',
        notes: 'Admin updated lead basic details'
      }
    });

    const companyChanged = (existing.companyName || null) !== (nextCompanyName || null);
    const companyBrandChanged = nextCompanyBrand !== undefined && (existingCompanyBrandVal || null) !== (nextCompanyBrand || null);
    if (companyChanged || companyBrandChanged) {
      await ensureResearch(updated, { force: true });
      await prisma.leadActivity.create({
        data: {
          leadId,
          userId: req.user.user_id,
          action: 'research_refreshed',
          notes: `Research auto-refreshed after ${companyChanged ? 'company' : ''}${companyChanged && companyBrandChanged ? ' and ' : ''}${companyBrandChanged ? 'company brand' : ''} update`
        }
      });
    }

    // Re-fetch to ensure we return fresh data including personalRemarks
    const fresh = await prisma.lead.findUnique({
      where: { leadId },
      include: { assignedUser: { select: { userId: true, name: true, role: true } } }
    });
    const leadToReturn = fresh || updated;
    if (leadToReturn && leadToReturn.companyBrand === undefined && leadToReturn.company_brand === undefined) {
      const cbRes2 = await pool.query('SELECT company_brand FROM leads WHERE lead_id = $1', [leadId]);
      leadToReturn.companyBrand = cbRes2.rows[0]?.company_brand ?? null;
    }
    res.json({ success: true, lead: leadToReturn });
  } catch (error) {
    console.error('Update lead basic details error:', error);
    res.status(500).json({ success: false, message: 'Server error updating lead details' });
  }
};

exports.getLeadAddresses = async (req, res) => {
  const { id } = req.params;
  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canEditLead(req.user, lead)) return res.status(403).json({ success: false, message: 'Access denied' });
    const rows = await pool.query(
      `SELECT address_id, concern_person, mobile_no, address, pincode, address_type, created_at
       FROM lead_addresses
       WHERE lead_id = $1
       ORDER BY created_at DESC`,
      [id]
    );
    res.json({ success: true, addresses: rows.rows });
  } catch (error) {
    console.error('Get lead addresses error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching addresses' });
  }
};

exports.addLeadAddress = async (req, res) => {
  const { id } = req.params;
  const { concern_person, mobile_no, address, pincode, address_type } = req.body || {};
  if (!address || !String(address).trim()) {
    return res.status(400).json({ success: false, message: 'Address is required' });
  }
  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canEditLead(req.user, lead)) return res.status(403).json({ success: false, message: 'Access denied' });
    const inserted = await pool.query(
      `INSERT INTO lead_addresses (lead_id, concern_person, mobile_no, address, pincode, address_type, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       RETURNING address_id, concern_person, mobile_no, address, pincode, address_type, created_at`,
      [id, concern_person || null, mobile_no || null, String(address).trim(), pincode || null, address_type || 'Shipping', req.user.user_id]
    );
    res.status(201).json({ success: true, address: inserted.rows[0] });
  } catch (error) {
    console.error('Add lead address error:', error);
    res.status(500).json({ success: false, message: 'Server error adding address' });
  }
};

exports.deleteLeadAddress = async (req, res) => {
  const { id, address_id } = req.params;
  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canEditLead(req.user, lead)) return res.status(403).json({ success: false, message: 'Access denied' });
    const result = await pool.query(
      `DELETE FROM lead_addresses WHERE lead_id = $1 AND address_id = $2`,
      [id, address_id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Address not found' });
    res.json({ success: true, message: 'Address deleted' });
  } catch (error) {
    console.error('Delete lead address error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting address' });
  }
};

exports.addLeadRemark = async (req, res) => {
  const { id } = req.params;
  const { note } = req.body || {};
  if (!note || !String(note).trim()) {
    return res.status(400).json({ success: false, message: 'Remark note is required' });
  }
  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canEditLead(req.user, lead)) return res.status(403).json({ success: false, message: 'Access denied' });
    const inserted = await pool.query(
      `INSERT INTO lead_remarks (lead_id, user_id, note, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       RETURNING remark_id, lead_id, user_id, note, created_at`,
      [id, req.user.user_id, String(note).trim()]
    );
    const row = inserted.rows[0];
    res.status(201).json({
      success: true,
      remark: {
        remarkId: row.remark_id,
        leadId: row.lead_id,
        userId: row.user_id,
        note: row.note,
        createdAt: row.created_at,
        userName: req.user.name
      }
    });
  } catch (error) {
    console.error('Add lead remark error:', error);
    res.status(500).json({ success: false, message: 'Server error adding remark' });
  }
};

exports.deleteLeadRemark = async (req, res) => {
  const { id, remark_id } = req.params;
  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canEditLead(req.user, lead)) return res.status(403).json({ success: false, message: 'Access denied' });
    const result = await pool.query(
      `DELETE FROM lead_remarks WHERE lead_id = $1 AND remark_id = $2`,
      [id, remark_id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Remark not found' });
    res.json({ success: true, message: 'Remark deleted' });
  } catch (error) {
    console.error('Delete lead remark error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting remark' });
  }
};

exports.getLeadCustomerProfile = async (req, res) => {
  const { id } = req.params;
  try {
    const lead = await prisma.lead.findUnique({ where: { leadId: parseInt(id, 10) } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canEditLead(req.user, lead)) return res.status(403).json({ success: false, message: 'Access denied' });

    const customerRes = await pool.query(
      `SELECT customer_id, name, company_name, email, phone, gst_no
       FROM customers
       WHERE source_lead_id = $1
       LIMIT 1`,
      [id]
    );
    if (!customerRes.rows.length) return res.json({ success: true, customer: null, addresses: [] });
    const customer = customerRes.rows[0];
    const addressesRes = await pool.query(
      `SELECT customer_address_id, concern_person, mobile_no, address, pincode, is_head_office, address_type
       FROM customer_addresses
       WHERE customer_id = $1
       ORDER BY is_head_office DESC, customer_address_id ASC`,
      [customer.customer_id]
    );
    res.json({ success: true, customer, addresses: addressesRes.rows });
  } catch (error) {
    console.error('Get lead customer profile error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching customer profile' });
  }
};

exports.getLeadOrders = async (req, res) => {
  const { status } = req.query;

  try {
    const where = status ? { orderStatus: status } : {};
    const uid = currentUserId(req.user);
    const assignedOnly = await isRestrictedToAssigned(req, 'lead_orders');
    if (assignedOnly && uid != null) {
      where.lead = { assignedUserId: uid };
    }
    const orders = await prisma.leadOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        lead: { select: { leadId: true, name: true, companyName: true, status: true } }
      }
    });

    res.json({ success: true, count: orders.length, orders });
  } catch (error) {
    console.error('Get lead orders error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching orders' });
  }
};

exports.getAutoAssignConfig = async (req, res) => {
  try {
    const { getAutoAssignConfig } = require('../services/leadAutoAssignService');
    const config = await getAutoAssignConfig();
    res.json({ success: true, ...config });
  } catch (error) {
    console.error('Get auto-assign config error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getReports = async (req, res) => {
  try {
    const totalLeads = await prisma.lead.count();

    const statusWise = await prisma.lead.groupBy({
      by: ['status'],
      _count: { status: true }
    });

    const teamWise = await prisma.$queryRaw`
      SELECT
        COALESCE(u.name, 'Unassigned') AS team_name,
        COUNT(l.lead_id)::int AS count
      FROM leads l
      LEFT JOIN users u ON l.assigned_user_id = u.user_id
      GROUP BY u.user_id, u.name
      ORDER BY count DESC, team_name
    `;

    const pendingLeads = await prisma.$queryRaw`
      SELECT COUNT(l.lead_id)::int AS count
      FROM leads l
      LEFT JOIN lead_activities a ON a.lead_id = l.lead_id
      WHERE a.lead_id IS NULL
    `;

    const dealCount = await prisma.lead.count({
      where: { status: 'Deal' }
    });

    const ordersCountRes = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM orders`;
    const ordersCount = ordersCountRes[0]?.count || 0;

    res.json({
      success: true,
      totals: {
        totalLeads,
        pendingLeads: pendingLeads[0]?.count || 0,
        deals: dealCount,
        orders: ordersCount
      },
      statusWise: statusWise.map(s => ({ status: s.status, count: s._count.status })),
      teamWise
    });
  } catch (error) {
    console.error('Lead reports error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching reports' });
  }
};

/** Default To/CC layout for the lead quotation email UI. */
exports.getQuotationEmailConfig = async (req, res) => {
  try {
    const { getDefaultQuotationCc, buildDefaultCcRecipients } = require('../services/leadQuotationService');
    let senderEmail = String(req.user?.email || '').trim();
    if (!senderEmail && req.user?.user_id) {
      const ures = await pool.query('SELECT email FROM users WHERE user_id = $1', [req.user.user_id]);
      senderEmail = String(ures.rows[0]?.email || '').trim();
    }
    const defaultCc = getDefaultQuotationCc();
    const ccRecipients = buildDefaultCcRecipients(senderEmail);
    res.json({
      success: true,
      to_hint: 'Customer email (editable in send form)',
      default_cc: defaultCc,
      cc_recipients: ccRecipients,
      sender_email: senderEmail || null,
      from_address: process.env.QUOTATION_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || null,
    });
  } catch (error) {
    console.error('getQuotationEmailConfig:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendLeadQuotation = async (req, res) => {
  const { id } = req.params;
  const leadId = parseInt(id, 10);
  if (Number.isNaN(leadId)) {
    return res.status(400).json({ success: false, message: 'Invalid lead id' });
  }

  const applyQuotationConfigOne = (leadRow, configOne = {}) => {
    const use = (field) => {
      const v = configOne[field];
      if (v != null && String(v).trim() !== '') return String(v).trim();
      return leadRow[field] ?? null;
    };
    let brandOut;
    if (Object.prototype.hasOwnProperty.call(configOne, 'brand')) {
      const t = configOne.brand == null ? '' : String(configOne.brand).trim();
      brandOut = t === '' ? null : t;
    } else {
      brandOut = leadRow.brand ?? null;
    }
    return {
      ...leadRow,
      brand: brandOut,
      processor: use('processor'),
      generation: use('generation'),
      ram: use('ram'),
      storage: use('storage')
    };
  };

  try {
    const lead = await prisma.lead.findUnique({
      where: { leadId },
      include: { research: true }
    });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canEditLead(req.user, lead)) return res.status(403).json({ success: false, message: 'Access denied' });

    const body = req.body || {};
    const toEmail = String(body.to_email || lead.email || '')
      .trim()
      .toLowerCase();
    if (!toEmail) {
      return res.status(400).json({ success: false, message: 'Customer email is required' });
    }

    let senderEmail = String(req.user.email || '').trim();
    if (!senderEmail) {
      const ures = await pool.query('SELECT email FROM users WHERE user_id = $1', [req.user.user_id]);
      senderEmail = String(ures.rows[0]?.email || '').trim();
    }
    if (!senderEmail) {
      return res.status(400).json({
        success: false,
        message: 'Your account has no email address; add one to your user profile to receive CC'
      });
    }

    const billTo = {
      company_name: body.bill_to?.company_name || lead.companyName || lead.name,
      address: body.bill_to?.address,
      gstin: body.bill_to?.gstin ?? lead.research?.gst ?? '',
      email: body.bill_to?.email || lead.email || '',
      phone: body.bill_to?.phone || lead.phone || ''
    };
    if (!billTo.address || !String(billTo.address).trim()) {
      return res.status(400).json({ success: false, message: 'Bill To address is required' });
    }

    const shipSame = body.ship_same_as_bill === true || body.ship_same_as_bill === '1' || body.ship_same_as_bill === 1;
    let shipTo;
    if (shipSame) {
      shipTo = { ...billTo };
    } else {
      shipTo = {
        company_name: body.ship_to?.company_name || billTo.company_name,
        address: body.ship_to?.address,
        gstin: body.ship_to?.gstin !== undefined ? body.ship_to.gstin : billTo.gstin,
        email: body.ship_to?.email || billTo.email,
        phone: body.ship_to?.phone || billTo.phone
      };
      if (!shipTo.address || !String(shipTo.address).trim()) {
        return res.status(400).json({
          success: false,
          message: 'Ship To address is required, or enable “Same as Bill To”'
        });
      }
    }

    const quantity = parseInt(String(body.quantity ?? '1'), 10);
    const monthlyRate = Number(body.monthly_rate);
    const lockinMonths = parseInt(String(body.lockin_months ?? '6'), 10) || 6;
    const securityMonths = parseInt(String(body.security_months ?? '1'), 10);
    if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) {
      return res.status(400).json({ success: false, message: 'Valid monthly rental rate is required' });
    }
    if (![1, 2].includes(securityMonths)) {
      return res.status(400).json({ success: false, message: 'Security deposit must be 1 or 2 months of rent' });
    }

    const {
      buildQuotationPdfAndSend,
      formatEstimateDate,
      DEFAULT_HSN_SAC,
      buildConfigOneFromLead,
      isConfigTwoActive,
      parseCcList
    } = require('../services/leadQuotationService');

    const acceptToken = crypto.randomBytes(24).toString('hex');
    const ccExtra = parseCcList(body.cc_emails);
    const ccRecipients = Array.isArray(body.cc_recipients)
      ? body.cc_recipients.map((e) => String(e).trim()).filter(Boolean)
      : (body.cc_recipients
        ? parseCcList(body.cc_recipients)
        : null);

    const leadForQuote = applyQuotationConfigOne(lead, body.config_one || {});

    const specParts = [leadForQuote.processor, leadForQuote.generation, leadForQuote.ram, leadForQuote.storage].filter(Boolean);
    let line1 = specParts.join(', ');
    if (!line1) line1 = 'Laptop rental';
    if (leadForQuote.brand) line1 = `${leadForQuote.brand}, ${line1}`;
    const itemDescriptionLines = [
      line1,
      `Lockin period:${lockinMonths} months`,
      `Security Deposit:${securityMonths} month${securityMonths === 1 ? '' : 's'}`
    ];

    const priorQuotations = await prisma.leadActivity.count({
      where: { leadId, action: 'quotation_sent' }
    });
    const nextSeq = priorQuotations + 1;
    const estimateNo = `EST-${leadId}-${nextSeq}`;

    const senderRow = await pool.query(
      `SELECT name, email, mobile_no FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );
    const senderName = senderRow.rows[0]?.name || '';
    const senderPhone = senderRow.rows[0]?.mobile_no || '';

    const config1 = buildConfigOneFromLead(leadForQuote, monthlyRate);

    const c2 = body.config_two || {};
    const config2Candidate = {
      processor: c2.processor != null ? String(c2.processor).trim() : '',
      ram: c2.ram != null ? String(c2.ram).trim() : '',
      storage: c2.storage != null ? String(c2.storage).trim() : '',
      monthlyRate: c2.monthly_rate != null && c2.monthly_rate !== '' ? Number(c2.monthly_rate) : null
    };

    if (isConfigTwoActive(config2Candidate)) {
      if (!Number.isFinite(config2Candidate.monthlyRate) || config2Candidate.monthlyRate <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Configuration 2 requires a valid monthly rental price when any Config 2 field is set'
        });
      }
    }

    await buildQuotationPdfAndSend({
      toEmail,
      senderEmail,
      senderName,
      senderPhone,
      billTo,
      shipTo,
      quantity,
      monthlyRate,
      lockinMonths,
      securityMonths,
      placeOfSupply: body.place_of_supply || 'Haryana (06)',
      hsnSac: body.hsn_sac || DEFAULT_HSN_SAC,
      itemDescriptionLines,
      estimateNo,
      estimateDate: body.estimate_date || formatEstimateDate(new Date()),
      companyName: billTo.company_name,
      ccExtra,
      ccRecipients: ccRecipients != null ? ccRecipients : null,
      acceptToken,
      emailConfig: {
        config1,
        config2: isConfigTwoActive(config2Candidate)
          ? {
              processor: config2Candidate.processor || '—',
              ram: config2Candidate.ram || '—',
              storage: config2Candidate.storage || '—',
              monthlyRate: config2Candidate.monthlyRate
            }
          : null
      }
    });

    await ensureLeadQuotationColumns();
    await pool.query(
      `UPDATE leads
       SET quotation_accept_token = $1,
           quotation_accepted_at = NULL,
           quotation_last_sent_at = NOW(),
           quotation_last_estimate_no = $2,
           quotation_last_to_email = $3
       WHERE lead_id = $4`,
      [acceptToken, estimateNo, toEmail, leadId]
    );

    try {
      await prisma.leadActivity.create({
        data: {
          leadId,
          userId: req.user.user_id,
          action: 'quotation_sent',
          notes: `Quotation ${estimateNo} emailed to ${toEmail}`
        }
      });
    } catch (logErr) {
      console.error('Lead activity log failed after quotation sent:', logErr);
    }

    res.json({
      success: true,
      message: 'Quotation emailed to customer with PDF attached.',
      estimate_no: estimateNo,
      quotation_last_sent_at: new Date().toISOString(),
      quotation_last_estimate_no: estimateNo
    });
  } catch (error) {
    console.error('Send lead quotation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send quotation'
    });
  }
};

exports.getLeadStages = async (_req, res) => {
  try {
    const stages = Object.entries(STAGES_BY_STATUS).map(([status, stageList]) => ({
      status,
      stages: stageList
    }));
    res.json({ success: true, stages });
  } catch (error) {
    console.error('getLeadStages error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching stages' });
  }
};

exports.updateLeadFullProfile = async (req, res) => {
  const { id } = req.params;
  const leadId = parseInt(id, 10);
  if (Number.isNaN(leadId)) {
    return res.status(400).json({ success: false, message: 'Invalid lead id' });
  }

  try {
    const existing = await prisma.lead.findUnique({ where: { leadId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!canEditLead(req.user, existing)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const body = req.body || {};
    const changes = [];
    const setClauses = [];
    const params = [];
    let idx = 1;

    const addField = (dbCol, value, label, prevVal) => {
      if (value === undefined) return;
      setClauses.push(`${dbCol} = $${idx}`);
      params.push(value);
      idx += 1;
      const prev = prevVal == null ? '' : String(prevVal);
      const next = value == null ? '' : String(value);
      if (prev !== next) changes.push(label);
    };

    const pick = (snake, camel) => (body[snake] !== undefined ? body[snake] : body[camel]);

    addField('name', pick('name', 'name')?.trim?.() ?? pick('name', 'name'), 'name', existing.name);
    addField('company_name', pick('company_name', 'companyName'), 'company', existing.companyName);
    addField('company_brand', pick('company_brand', 'companyBrand'), 'company brand', existing.companyBrand);
    addField('email', pick('email', 'email') != null ? normalizeEmail(pick('email', 'email')) : undefined, 'email', existing.email);
    addField('phone', pick('phone', 'phone') != null ? normalizePhone(pick('phone', 'phone')) : undefined, 'phone', existing.phone);
    addField('whatsapp_number', pick('whatsapp_number', 'whatsappNumber'), 'whatsapp', existing.whatsappNumber);
    addField('designation', pick('designation', 'designation'), 'designation', existing.designation);
    addField('quantity_required', pick('quantity_required', 'quantityRequired'), 'quantity', existing.quantityRequired);
    addField('monthly_budget', pick('monthly_budget', 'monthlyBudget'), 'budget', existing.monthlyBudget);
    addField('rental_duration', pick('rental_duration', 'rentalDuration'), 'duration', existing.rentalDuration);
    addField('use_case', pick('use_case', 'useCase'), 'use case', existing.useCase);
    addField('company_type', pick('company_type', 'companyType'), 'company type', existing.companyType);
    addField('company_size', pick('company_size', 'companySize'), 'company size', existing.companySize);
    addField('industry', pick('industry', 'industry'), 'industry', existing.industry);
    addField('annual_revenue', pick('annual_revenue', 'annualRevenue'), 'revenue', existing.annualRevenue);
    addField('pan_number', pick('pan_number', 'panNumber'), 'PAN', existing.panNumber);
    addField('gst_number', pick('gst_number', 'gstNumber'), 'GST', existing.gstNumber);
    addField('state', pick('state', 'state'), 'state', existing.state);
    addField('pincode', pick('pincode', 'pincode'), 'pincode', existing.pincode);
    addField('city', pick('city', 'city'), 'city', existing.city);
    addField('billing_address', pick('billing_address', 'billingAddress'), 'billing address', existing.billingAddress);
    addField('shipping_same_as_billing', pick('shipping_same_as_billing', 'shippingSameAsBilling'), 'shipping same', existing.shippingSameAsBilling);
    addField('shipping_address', pick('shipping_address', 'shippingAddress'), 'shipping address', existing.shippingAddress);
    addField('inquiry_type', pick('inquiry_type', 'inquiryType'), 'inquiry type', existing.inquiryType);
    addField('personal_remarks', pick('personal_remarks', 'personalRemarks'), 'remarks', existing.personalRemarks);
    addField('brand', pick('brand', 'brand'), 'brand', existing.brand);
    addField('processor', pick('processor', 'processor'), 'processor', existing.processor);
    addField('generation', pick('generation', 'generation'), 'generation', existing.generation);
    addField('ram', pick('ram', 'ram'), 'ram', existing.ram);
    addField('storage', pick('storage', 'storage'), 'storage', existing.storage);
    addField('source', pick('source', 'source'), 'source', existing.source);

    if (pick('assigned_user_id', 'assignedUserId') !== undefined) {
      const uid = pick('assigned_user_id', 'assignedUserId');
      addField('assigned_user_id', uid ? parseInt(uid, 10) : null, 'assignee', existing.assignedUserId);
    }

    if (pick('follow_up_date', 'followUpDate') !== undefined) {
      const fud = pick('follow_up_date', 'followUpDate');
      addField('follow_up_date', fud ? new Date(fud) : null, 'follow-up date', existing.followUpDate);
    }

    if (pick('follow_up_time', 'followUpTime') !== undefined) {
      const t = normalizeFollowUpTimeForDb(pick('follow_up_time', 'followUpTime'));
      setClauses.push(`follow_up_time = $${idx}::time`);
      params.push(t);
      idx += 1;
      const prev = formatFollowUpTime(existing.followUpTime) ?? '';
      const next = formatFollowUpTime(t) ?? '';
      if (prev !== next) changes.push('follow-up time');
    }

    if (!setClauses.length) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    setClauses.push('updated_at = NOW()');
    params.push(leadId);
    await pool.query(
      `UPDATE leads SET ${setClauses.join(', ')} WHERE lead_id = $${idx}`,
      params
    );

    const updated = await prisma.lead.findUnique({
      where: { leadId },
      include: { assignedUser: { select: { userId: true, name: true, role: true } } }
    });
    serializeLeadFollowUpTime(updated);

    await prisma.leadActivity.create({
      data: {
        leadId,
        userId: req.user.user_id,
        action: 'profile_updated',
        notes: changes.length ? `Updated: ${changes.join(', ')}` : 'Profile updated'
      }
    });

    res.json({ success: true, lead: updated });
  } catch (error) {
    console.error('updateLeadFullProfile error:', error);
    res.status(500).json({ success: false, message: 'Server error updating profile' });
  }
};

function parseCustomerDetails(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

exports.convertToCustomer = async (req, res) => {
  const { id } = req.params;
  const leadId = parseInt(id, 10);
  if (Number.isNaN(leadId)) {
    return res.status(400).json({ success: false, message: 'Invalid lead id' });
  }

  try {
    const leadRes = await pool.query('SELECT * FROM leads WHERE lead_id = $1', [leadId]);
    if (!leadRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const lead = leadRes.rows[0];

    if (!['Deal', 'Demo'].includes(lead.status)) {
      return res.status(400).json({
        success: false,
        message: 'Lead must be in Deal or Demo status to convert'
      });
    }

    if (await denyUnlessCanEditLead(req, res, lead)) return;

    const body = req.body || {};
    const billingAddress = body.billing_address || lead.billing_address || null;
    const billingCity = body.billing_city || body.city || lead.city || null;
    const billingState = body.billing_state || body.state || lead.state || null;
    const billingPincode = body.billing_pincode || body.pincode || lead.pincode || null;

    if (!billingAddress || !billingCity || !billingState || !billingPincode) {
      return res.status(400).json({
        success: false,
        message: 'Billing address, city, state, and pincode are required'
      });
    }

    const contactValidationErrors = validateFinanceExpoxContactFields(body);
    if (contactValidationErrors.length) {
      return res.status(400).json({ success: false, message: contactValidationErrors[0] });
    }

    const shippingSame = body.shipping_same_as_billing !== false && body.shipping_same !== false
      && lead.shipping_same_as_billing !== false;
    const shippingAddress = shippingSame
      ? billingAddress
      : (body.shipping_address || lead.shipping_address || billingAddress);
    const shippingCity = shippingSame ? billingCity : (body.shipping_city || lead.city || billingCity);
    const shippingState = shippingSame ? billingState : (body.shipping_state || lead.state || billingState);
    const shippingPincode = shippingSame ? billingPincode : (body.shipping_pincode || lead.pincode || billingPincode);

    const customerName = body.customer_name || body.name || lead.name;
    const companyName = body.company_name || lead.company_name || null;
    const email = body.email || lead.email || null;
    const phone = body.phone || lead.phone || null;
    const gstNo = body.gst_number || body.gst_no || lead.gst_number || null;
    const panNumber = body.pan_number || lead.pan_number || null;

    const customerDetails = {
      contact_person_name: customerName,
      contact_person_number: phone,
    };
    applyFinanceExpoxDetails(customerDetails, body);

    let customerId = lead.customer_id;
    let isNew = false;

    const existingByLead = await pool.query(
      'SELECT customer_id FROM customers WHERE source_lead_id = $1',
      [leadId]
    );

    if (existingByLead.rows.length) {
      customerId = existingByLead.rows[0].customer_id;
      const existingDetailsRes = await pool.query(
        'SELECT details FROM customers WHERE customer_id = $1',
        [customerId]
      );
      const mergedDetails = parseCustomerDetails(existingDetailsRes.rows[0]?.details);
      mergedDetails.contact_person_name = customerName;
      mergedDetails.contact_person_number = phone;
      applyFinanceExpoxDetails(mergedDetails, body);
      await pool.query(
        `UPDATE customers SET
          name = $1, company_name = $2, email = $3, phone = $4, gst_no = $5,
          pan_number = $6, company_type = $7, company_size = $8, industry = $9,
          billing_address = $10, billing_city = $11, billing_state = $12, billing_pincode = $13,
          shipping_same = $14, shipping_address = $15, shipping_city = $16, shipping_state = $17, shipping_pincode = $18,
          whatsapp_number = $19, designation = $20, source_lead_stage = $21,
          onboarded_by = $22, onboarded_at = COALESCE(onboarded_at, NOW()), details = $23, updated_at = NOW()
         WHERE customer_id = $24`,
        [
          customerName, companyName, email, phone, gstNo, panNumber,
          lead.company_type, lead.company_size, lead.industry,
          billingAddress, billingCity, billingState, billingPincode,
          shippingSame, shippingAddress, shippingCity, shippingState, shippingPincode,
          lead.whatsapp_number, lead.designation, lead.lead_stage,
          req.user.user_id, JSON.stringify(mergedDetails), customerId
        ]
      );
    } else {
      const insertRes = await pool.query(
        `INSERT INTO customers (
          name, company_name, source_lead_id, email, phone, gst_no, pan_number,
          company_type, company_size, industry,
          billing_address, billing_city, billing_state, billing_pincode,
          shipping_same, shipping_address, shipping_city, shipping_state, shipping_pincode,
          whatsapp_number, designation, source_lead_stage, onboarded_by, onboarded_at,
          type, details, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, NOW(), 'Lead', $24, NOW(), NOW()
        ) RETURNING customer_id`,
        [
          customerName, companyName, leadId, email, phone, gstNo, panNumber,
          lead.company_type, lead.company_size, lead.industry,
          billingAddress, billingCity, billingState, billingPincode,
          shippingSame, shippingAddress, shippingCity, shippingState, shippingPincode,
          lead.whatsapp_number, lead.designation, lead.lead_stage,
          req.user.user_id, JSON.stringify(customerDetails)
        ]
      );
      customerId = insertRes.rows[0].customer_id;
      isNew = true;
    }

    await pool.query(
      `UPDATE leads SET
        customer_id = $1, converted_at = NOW(), converted_by = $2, updated_at = NOW()
       WHERE lead_id = $3`,
      [customerId, req.user.user_id, leadId]
    );

    await prisma.leadActivity.create({
      data: {
        leadId,
        userId: req.user.user_id,
        action: 'converted_to_customer',
        notes: `Converted to customer #${customerId}`
      }
    });

    res.json({ success: true, customer_id: customerId, is_new: isNew });
  } catch (error) {
    console.error('convertToCustomer error:', error);
    res.status(500).json({ success: false, message: error.message || 'Conversion failed' });
  }
};

exports.getLeadConversionStatus = async (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  if (Number.isNaN(leadId)) {
    return res.status(400).json({ success: false, message: 'Invalid lead id' });
  }

  try {
    const result = await pool.query(
      `SELECT l.customer_id, l.converted_at, l.converted_by, c.name AS customer_name, c.company_name
       FROM leads l
       LEFT JOIN customers c ON c.customer_id = l.customer_id
       WHERE l.lead_id = $1`,
      [leadId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const row = result.rows[0];
    res.json({
      success: true,
      converted: !!row.customer_id,
      customer_id: row.customer_id,
      converted_at: row.converted_at,
      customer_name: row.customer_name || row.company_name || null
    });
  } catch (error) {
    console.error('getLeadConversionStatus error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getEmailSyncStatus = async (_req, res) => {
  try {
    res.json({ success: true, ...getLeadEmailSyncStatus() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.triggerEmailSync = async (_req, res) => {
  try {
    const status = getLeadEmailSyncStatus();
    if (!status.configured) {
      return res.status(400).json({
        success: false,
        message: 'Lead email IMAP is not configured (LEAD_EMAIL_IMAP_HOST/USER/PASS)',
      });
    }
    const summary = await runLeadEmailSync();
    res.json({ success: true, summary, ...getLeadEmailSyncStatus() });
  } catch (error) {
    console.error('triggerEmailSync error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
