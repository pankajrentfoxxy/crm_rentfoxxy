require('dotenv').config();
const pool = require('../config/db');
const ctrl = require('../controllers/supportPartsController');

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function call(fn, req) {
  const res = mockRes();
  await fn(req, res);
  return res;
}

async function main() {
  const tech = (await pool.query(`SELECT user_id, name FROM users WHERE role='team_member' OR role='support_tech' ORDER BY user_id LIMIT 1`)).rows[0]
    || (await pool.query(`SELECT user_id, name FROM users ORDER BY user_id LIMIT 1`)).rows[0];
  const wh = (await pool.query(`SELECT user_id, name, email FROM users WHERE role IN ('warehouse','admin','super_admin') ORDER BY user_id LIMIT 1`)).rows[0];
  const ticket = (await pool.query(`SELECT id FROM support_tickets ORDER BY id LIMIT 1`)).rows[0];
  const part = (await pool.query(`SELECT part_id, part_name, quantity FROM parts WHERE NOT COALESCE(archived,false) AND quantity > 0 ORDER BY part_id LIMIT 1`)).rows[0];

  console.log('Actors:', { tech: tech.user_id, wh: wh.user_id, ticket: ticket.id, part: part.part_id, partQty: part.quantity });

  const techReq = (body = {}, params = {}, query = {}) => ({ user: { user_id: tech.user_id, role: 'support_tech' }, body, params, query });
  const whReq = (body = {}, params = {}, query = {}) => ({ user: { user_id: wh.user_id, role: 'warehouse', email: wh.email }, body, params, query });

  // 1. Raise
  let r = await call(ctrl.raiseSupportPartRequest, techReq({
    support_ticket_id: ticket.id, ttspl_id: 'TTSPL-TEST', part_id: part.part_id, quantity: 1, reason: 'phase19 test',
  }));
  console.log('1. raise:', r.statusCode, r.body.success, r.body.request?.request_number);
  const requestId = r.body.request.id;

  // 2. Approve + challan (warehouse)
  r = await call(ctrl.approveAndGenerateChallan, whReq({ request_ids: [requestId] }));
  console.log('2. approve+challan:', r.statusCode, r.body.success, r.body.challan_number);
  const challanId = r.body.challan_id;

  const afterApprove = (await pool.query(
    `SELECT pi.status FROM support_part_requests spr JOIN part_instances pi ON pi.instance_id=spr.instance_id WHERE spr.id=$1`, [requestId]
  )).rows[0];
  console.log('   instance status after approve (expect reserved):', afterApprove?.status);

  // 3. Sign + issue (warehouse captures tech sign)
  r = await call(ctrl.signAndIssueChallan, whReq({ esign_data: PNG, signer_name: tech.name }, { challanId: String(challanId) }));
  console.log('3. sign+issue:', r.statusCode, r.body.success, r.body.message);

  const afterIssue = (await pool.query(
    `SELECT pi.status AS inst, p.quantity FROM support_part_requests spr
     JOIN part_instances pi ON pi.instance_id=spr.instance_id
     JOIN parts p ON p.part_id=spr.part_id WHERE spr.id=$1`, [requestId]
  )).rows[0];
  console.log('   instance status (expect with_technician):', afterIssue?.inst, '| parts.qty:', afterIssue?.quantity, '(was', part.quantity, ')');

  // 4. Bucket (as tech)
  r = await call(ctrl.getTechnicianBucket, techReq());
  console.log('4. bucket total (expect >=1):', r.body.total, '| groups:', r.body.bucket.length);

  // 5. Return self (warehouse e-sign)
  r = await call(ctrl.returnPart, whReq({ method: 'self', esign_data: PNG, signer_name: wh.name }, { requestId: String(requestId) }));
  console.log('5. return self:', r.statusCode, r.body.success, r.body.message);

  const afterReturn = (await pool.query(
    `SELECT spr.status AS req, pi.status AS inst, p.quantity FROM support_part_requests spr
     JOIN part_instances pi ON pi.instance_id=spr.instance_id
     JOIN parts p ON p.part_id=spr.part_id WHERE spr.id=$1`, [requestId]
  )).rows[0];
  console.log('   request status (expect returned):', afterReturn?.req, '| instance (expect in_stock):', afterReturn?.inst, '| parts.qty:', afterReturn?.quantity);

  // 6. Challan PDF path
  const ch = (await pool.query(`SELECT challan_number, status, pdf_path, tech_esign_url, wh_esign_url FROM support_part_challans WHERE id=$1`, [challanId])).rows[0];
  console.log('6. challan:', ch.challan_number, '| status:', ch.status, '| pdf:', !!ch.pdf_path, '| techSign:', !!ch.tech_esign_url, '| whSign:', !!ch.wh_esign_url);

  console.log('\nDONE.');
  process.exit(0);
}
main().catch((e) => { console.error('FLOW FAILED:', e.message, e.stack); process.exit(1); });
