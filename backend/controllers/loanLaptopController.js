const pool = require('../config/db');
const loanService = require('../services/loanLaptopService');
const policyService = require('../services/loanReplacementPolicyService');
const { assertLoanSchema } = require('../services/loanSchema');

function sendError(res, err, label) {
  const status = err.status || 500;
  if (status >= 500) console.error(`loanLaptop.${label}`, err);
  return res.status(status).json({
    success: false,
    message: status >= 500 ? (err.message || 'Server error') : err.message,
    code: err.code || undefined,
    current_status: err.current_status || undefined,
    reasons: err.reasons || undefined,
    policy: err.policy || undefined,
  });
}

/** Run `fn(client)` in one transaction; every write in the workflow goes through here. */
async function inTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const intParam = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

exports.list = async (req, res) => {
  try {
    const out = await loanService.listLoanRequests(pool, {
      status: req.query.status || null,
      queue: req.query.queue || null,
      customerId: intParam(req.query.customer_id),
      ticketId: intParam(req.query.ticket_id),
      q: req.query.q || '',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, data: out.rows, total: out.total });
  } catch (e) { sendError(res, e, 'list'); }
};

exports.counts = async (req, res) => {
  try {
    res.json({ success: true, data: await loanService.queueCounts(pool) });
  } catch (e) { sendError(res, e, 'counts'); }
};

exports.get = async (req, res) => {
  try {
    res.json({ success: true, data: await loanService.getLoanRequest(pool, intParam(req.params.id)) });
  } catch (e) { sendError(res, e, 'get'); }
};

exports.ticketContext = async (req, res) => {
  try {
    res.json({ success: true, data: await loanService.getTicketLoanContext(pool, intParam(req.params.ticketId)) });
  } catch (e) { sendError(res, e, 'ticketContext'); }
};

exports.availableLaptops = async (req, res) => {
  try {
    const pickupItemId = intParam(req.query.pickup_item_id);
    if (!pickupItemId) return res.status(400).json({ success: false, message: 'pickup_item_id is required' });
    const data = await loanService.listAvailableLaptops(pool, { pickupItemId, q: req.query.q, limit: req.query.limit });
    res.json({ success: true, data });
  } catch (e) { sendError(res, e, 'availableLaptops'); }
};

exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const ticketId = intParam(b.ticket_id);
    if (!ticketId) return res.status(400).json({ success: false, message: 'ticket_id is required' });
    const request = await inTx((db) => loanService.createLoanRequest(db, {
      ticketId,
      pickupItemId: intParam(b.pickup_item_id),
      loanSerialId: intParam(b.loan_serial_id),
      deliveryAddress: b.delivery_address,
      contactName: b.contact_name,
      contactPhone: b.contact_phone,
      remarks: b.remarks,
      actor: req.user,
    }));
    res.status(201).json({ success: true, data: request });
  } catch (e) { sendError(res, e, 'create'); }
};

exports.approve = async (req, res) => {
  try {
    const out = await inTx((db) => loanService.approveLoanRequest(db, intParam(req.params.id), {
      approvedRate: req.body?.approved_rent_monthly_rate,
      remarks: req.body?.remarks,
      actor: req.user,
    }));
    res.json({ success: true, data: out, already: Boolean(out.already) });
  } catch (e) { sendError(res, e, 'approve'); }
};

exports.reject = async (req, res) => {
  try {
    const out = await inTx((db) => loanService.rejectLoanRequest(db, intParam(req.params.id), {
      reason: req.body?.reason, actor: req.user,
    }));
    res.json({ success: true, data: out, already: Boolean(out.already) });
  } catch (e) { sendError(res, e, 'reject'); }
};

exports.createLoanDc = async (req, res) => {
  try {
    const out = await inTx((db) => loanService.createLoanDc(db, intParam(req.params.id), {
      dispatch: req.body || {}, actor: req.user,
    }));
    let pdfPath = null;
    if (!out.already) {
      const { regenerateLoanDcPdf } = require('../services/loanDcPdfService');
      pdfPath = await regenerateLoanDcPdf(pool, out.dc_number);
    }
    res.status(out.already ? 200 : 201).json({ success: true, data: { ...out, pdf_path: pdfPath }, already: Boolean(out.already) });
  } catch (e) { sendError(res, e, 'createLoanDc'); }
};

exports.regenerateLoanDcPdf = async (req, res) => {
  try {
    await assertLoanSchema(pool);
    const r = await pool.query(`SELECT loan_dc_number FROM support_loan_requests WHERE id = $1`, [intParam(req.params.id)]);
    const dc = r.rows[0]?.loan_dc_number;
    if (!dc) return res.status(404).json({ success: false, message: 'No Loan DC on this request' });
    const { regenerateLoanDcPdf } = require('../services/loanDcPdfService');
    const pdfPath = await regenerateLoanDcPdf(pool, dc);
    if (!pdfPath) return res.status(500).json({ success: false, message: 'PDF generation failed' });
    res.json({ success: true, data: { dc_number: dc, pdf_path: pdfPath } });
  } catch (e) { sendError(res, e, 'regenerateLoanDcPdf'); }
};

exports.repairCompleted = async (req, res) => {
  try {
    const out = await inTx((db) => loanService.markRepairCompleted(db, intParam(req.params.id), {
      override: req.body?.override === true,
      remarks: req.body?.remarks,
      actor: req.user,
    }));
    res.json({ success: true, data: out, already: Boolean(out.already) });
  } catch (e) { sendError(res, e, 'repairCompleted'); }
};

exports.decision = async (req, res) => {
  try {
    const b = req.body || {};
    const out = await inTx((db) => loanService.recordCustomerDecision(db, intParam(req.params.id), {
      decision: b.decision,
      confirmation: b.confirmation,
      returnPickup: b.return_pickup,
      serviceDc: b.service_dc,
      proposedEffectiveDate: b.proposed_effective_date,
      proposedRate: b.proposed_rent_monthly_rate,
      remarks: b.remarks,
      actor: req.user,
    }));
    res.json({ success: true, data: out, already: Boolean(out.already) });
  } catch (e) { sendError(res, e, 'decision'); }
};

exports.approveConversion = async (req, res) => {
  try {
    const b = req.body || {};
    const out = await inTx((db) => loanService.approveConversion(db, intParam(req.params.id), {
      rentMonthlyRate: b.rent_monthly_rate,
      effectiveDate: b.effective_date,
      retroactiveAuthorized: b.retroactive_authorized === true,
      retroactiveReason: b.retroactive_reason,
      remarks: b.remarks,
      actor: req.user,
    }));
    res.json({ success: true, data: out, already: Boolean(out.already) });
  } catch (e) { sendError(res, e, 'approveConversion'); }
};

exports.rejectConversion = async (req, res) => {
  try {
    const out = await inTx((db) => loanService.rejectConversion(db, intParam(req.params.id), {
      reason: req.body?.reason, actor: req.user,
    }));
    res.json({ success: true, data: out });
  } catch (e) { sendError(res, e, 'rejectConversion'); }
};

exports.cancel = async (req, res) => {
  try {
    const out = await inTx((db) => loanService.cancelLoanRequest(db, intParam(req.params.id), {
      reason: req.body?.reason, actor: req.user,
    }));
    res.json({ success: true, data: out, already: Boolean(out.already) });
  } catch (e) { sendError(res, e, 'cancel'); }
};

// ── policy ──────────────────────────────────────────────────────────────────

exports.getPolicy = async (req, res) => {
  try {
    await assertLoanSchema(pool);
    const policy = await policyService.loadPolicy(pool);
    res.json({
      success: true,
      data: {
        ...policy,
        decisions: policyService.DECISIONS,
        tier_relations: policyService.TIER_RELATIONS,
        fallback_decision: policyService.FALLBACK_DECISION,
      },
    });
  } catch (e) { sendError(res, e, 'getPolicy'); }
};

exports.evaluatePolicy = async (req, res) => {
  try {
    await assertLoanSchema(pool);
    const b = req.body || {};
    const specFor = async (serialId, spec) => {
      if (spec && typeof spec === 'object') return spec;
      if (!intParam(serialId)) return {};
      const r = await pool.query(`SELECT extra FROM vendor_serial_numbers WHERE serial_id = $1`, [intParam(serialId)]);
      const x = r.rows[0]?.extra || {};
      return { processor: x.processor, generation: x.generation };
    };
    const verdict = await policyService.evaluateForSpecs(
      pool,
      await specFor(b.original_serial_id, b.original_spec),
      await specFor(b.loan_serial_id, b.loan_spec)
    );
    res.json({ success: true, data: verdict });
  } catch (e) { sendError(res, e, 'evaluatePolicy'); }
};

exports.createRule = async (req, res) => {
  try {
    await assertLoanSchema(pool);
    res.status(201).json({ success: true, data: await policyService.createRule(pool, req.body, req.user?.user_id) });
  } catch (e) { sendError(res, e, 'createRule'); }
};

exports.updateRule = async (req, res) => {
  try {
    await assertLoanSchema(pool);
    res.json({ success: true, data: await policyService.updateRule(pool, intParam(req.params.ruleId), req.body, req.user?.user_id) });
  } catch (e) { sendError(res, e, 'updateRule'); }
};

exports.deleteRule = async (req, res) => {
  try {
    await assertLoanSchema(pool);
    res.json({ success: true, data: await policyService.deleteRule(pool, intParam(req.params.ruleId)) });
  } catch (e) { sendError(res, e, 'deleteRule'); }
};

exports.upsertTier = async (req, res) => {
  try {
    await assertLoanSchema(pool);
    res.json({ success: true, data: await policyService.upsertTier(pool, req.body, req.user?.user_id) });
  } catch (e) { sendError(res, e, 'upsertTier'); }
};

exports.deleteTier = async (req, res) => {
  try {
    await assertLoanSchema(pool);
    res.json({ success: true, data: await policyService.deleteTier(pool, req.params.family) });
  } catch (e) { sendError(res, e, 'deleteTier'); }
};
