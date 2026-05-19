const fs = require('fs');
const csv = require('csv-parser');
const crypto = require('crypto');
const prisma = require('../prisma/client');
const pool = require('../config/db');
const { ensureResearch } = require('../services/leadResearchService');
const { getNextAutoAssignee, updateAutoAssignConfig } = require('../services/leadAutoAssignService');

const { STATUSES_WITHOUT_STAGE_CHOICE, stagesForStatus } = require('../constants/leadStages');

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

const LEAD_STATUSES = ['Pending', 'Cold', 'Warm', 'Hot', 'Gone', 'Hold', 'Rejected', 'Call Back', 'Deal', 'Demo'];
const LEAD_SOURCE_OPTIONS = ['Google', 'LinkedIn', 'Team', 'References', 'Apollo'];

const csvEscape = (value) => {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

/** Shared Prisma where for list + CSV export */
function buildPrismaWhereForLeads(req) {
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

  if (req.user.role === 'sales') {
    andConditions.push({ assignedUserId: req.user.user_id });
  } else if (assigned_to) {
    const parts = normalizeArrayField(assigned_to);
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
const canEditLead = (user, lead) => {
  if (!user || !lead) return false;
  if (['admin', 'manager'].includes(user.role)) return true;
  if (user.role === 'sales') return lead.assignedUserId === user.user_id;
  return false;
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
    `SELECT l.lead_id, l.name, l.brand, l.company_name, l.email, l.phone, r.gst, r.address, r.city, r.state, r.pincode
     FROM leads l
     LEFT JOIN lead_company_research r ON r.lead_id = l.lead_id
     WHERE l.lead_id = $1`,
    [leadId]
  );
  if (!leadRes.rows.length) return null;
  const lead = leadRes.rows[0];
  const headOffice = formatHeadOfficeAddress(lead) || null;

  const customerUpsert = await pool.query(
    `INSERT INTO customers (name, company_name, source_lead_id, email, phone, gst_no, address, type, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Lead', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (source_lead_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       company_name = EXCLUDED.company_name,
       email = EXCLUDED.email,
       phone = EXCLUDED.phone,
       gst_no = EXCLUDED.gst_no,
       address = EXCLUDED.address,
       updated_at = CURRENT_TIMESTAMP
     RETURNING customer_id`,
    [
      lead.name || lead.company_name || 'Lead Customer',
      lead.company_name || null,
      lead.lead_id,
      lead.email || null,
      lead.phone || null,
      lead.gst || null,
      headOffice
    ]
  );
  const customerId = customerUpsert.rows[0].customer_id;

  if (headOffice) {
    await pool.query(
      `INSERT INTO customer_addresses (customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, 'Billing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (customer_id, is_head_office)
       WHERE is_head_office = true
       DO UPDATE SET
         concern_person = EXCLUDED.concern_person,
         mobile_no = EXCLUDED.mobile_no,
         address = EXCLUDED.address,
         pincode = EXCLUDED.pincode,
         address_type = EXCLUDED.address_type,
         updated_at = CURRENT_TIMESTAMP`,
      [customerId, lead.name || null, lead.phone || null, headOffice, lead.pincode || null]
    );
  }

  await pool.query(
    `INSERT INTO customer_addresses (customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type, source_lead_address_id, created_at, updated_at)
     SELECT $1, la.concern_person, la.mobile_no, la.address, la.pincode, false, COALESCE(la.address_type, 'Shipping'), la.address_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     FROM lead_addresses la
     WHERE la.lead_id = $2
     ON CONFLICT (source_lead_address_id) DO NOTHING`,
    [customerId, leadId]
  );

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

exports.getLeads = async (req, res) => {
  try {
    const where = buildPrismaWhereForLeads(req);

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        assignedUser: { select: { userId: true, name: true, role: true } },
        research: true
      }
    });

    res.json({ success: true, count: leads.length, leads });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching leads' });
  }
};

exports.exportLeadsCsv = async (req, res) => {
  try {
    const where = buildPrismaWhereForLeads(req);
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

    if (req.user.role === 'sales' && lead.assignedUserId !== req.user.user_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

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

    const hasSalesAccess = Array.isArray(req.user.permissions) && req.user.permissions.includes('sales_access');
    const isSalesOperator = req.user.role === 'sales' || (!['admin', 'manager'].includes(req.user.role) && hasSalesAccess);

    let assignData = {};
    if (isSalesOperator) {
      assignData = { assignedUserId: req.user.user_id, assignedById: req.user.user_id, assignedAt: new Date() };
    } else {
      const autoAssignee = await getNextAutoAssignee();
      if (autoAssignee) {
        assignData = { assignedUserId: autoAssignee, assignedById: req.user.user_id, assignedAt: new Date() };
      }
    }

    const lead = await prisma.lead.create({
      data: {
        ...payload,
        companyBrand: payload.companyBrand,
        brand: payload.brand,
        status: 'Pending',
        createdAt: new Date(),
        ...assignData,
        isDuplicate: !!duplicateOf,
        duplicateOf: duplicateOf || null
      }
    });

    await prisma.leadActivity.create({
      data: {
        leadId: lead.leadId,
        userId: req.user.user_id,
        action: 'lead_created',
        notes: 'Lead created'
      }
    });

    // Trigger research in background (don't block response)
    ensureResearch(lead).catch((err) => console.error('Lead research error:', err));

    res.status(201).json({ success: true, lead });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ success: false, message: 'Server error creating lead' });
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

exports.updateLeadStatus = async (req, res) => {
  const { id } = req.params;
  const { status, rejection_reason, notes, lead_stage, brand, processor, generation, ram, storage, gst: gstInput } = req.body;

  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid lead status' });
  }

  const normalizeGst = (s) =>
    String(s || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
  const isValidIndianGstin = (s) =>
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(normalizeGst(s));

  try {
    const lead = await prisma.lead.findUnique({
      where: { leadId: parseInt(id, 10) },
      include: { research: true }
    });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    if (req.user.role === 'sales' && lead.assignedUserId !== req.user.user_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

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
      if (gstInput !== undefined && gstInput !== null && String(gstInput).trim() !== '') {
        const g = normalizeGst(gstInput);
        if (!isValidIndianGstin(g)) {
          return res.status(400).json({ success: false, message: 'Invalid GSTIN format (15-character GSTIN required).' });
        }
      }
      const fromBody =
        gstInput !== undefined && gstInput !== null && String(gstInput).trim() !== '' ? normalizeGst(gstInput) : null;
      const fromResearch =
        lead.research?.gst && isValidIndianGstin(lead.research.gst) ? normalizeGst(lead.research.gst) : null;
      const resolvedGst =
        fromBody && isValidIndianGstin(fromBody) ? fromBody : fromResearch && isValidIndianGstin(fromResearch) ? fromResearch : null;
      if (!resolvedGst) {
        return res.status(400).json({
          success: false,
          message:
            'GSTIN is mandatory for Deal or Demo. Add a valid GST in company research or send gst in the request before linking to Customers.'
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
    if (req.user.role === 'sales' && lead.assignedUserId !== req.user.user_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const updated = await prisma.lead.update({
      where: { leadId: parseInt(id, 10) },
      data: { followUpDate: follow_up_date ? new Date(follow_up_date) : null }
    });

    await prisma.leadActivity.create({
      data: {
        leadId: updated.leadId,
        userId: req.user.user_id,
        action: 'follow_up_set',
        notes: notes || `Follow-up set to ${follow_up_date}`
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
    const baseWhere = req.user.role === 'sales'
      ? { assignedUserId: req.user.user_id }
      : {};

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
    if (req.user.role === 'sales' && lead.assignedUserId !== req.user.user_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

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
    if (req.user.role === 'sales' && lead.assignedUserId !== req.user.user_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

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
    if (req.user.role === 'sales' && lead.assignedUserId !== req.user.user_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

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
    if (req.user.role === 'sales') {
      where.lead = { assignedUserId: req.user.user_id };
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
