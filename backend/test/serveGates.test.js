/**
 * Part 6.3 step 5 — the four support permission holes (U21–U24).
 *
 * These are the contained, live-affecting half of Support v2. The schema
 * adoption and the UI rebuild are staged separately; these four are open on the
 * running system today and do not need any of that to be closed.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

require('dotenv').config({ path: `${__dirname}/../.env` });

const read = (p) => fs.readFileSync(`${__dirname}/../${p}`, 'utf8');

/** The guard list for one route line, as written in the router. */
function routeLine(src, verb, path) {
  const re = new RegExp(`^router\\.${verb}\\(\\s*'${path.replace(/[/:]/g, '\\$&')}'[^\\n]*`, 'm');
  const m = re.exec(src);
  return m ? m[0] : null;
}

describe('6.3 U21 — a parts challan is not readable by anyone with a login', () => {
  const src = read('routes/supportParts.js');

  it('the challan read now carries a permission guard', () => {
    const line = routeLine(src, 'get', '/challans/:challanId');
    assert.ok(line, 'the route must still exist');
    // Support safety (26 Sep 2026): requireWarehouse locked technicians out of
    // their own challans; they now pass the support guard and the controller
    // lets them read only a challan issued to them.
    assert.match(line, /requireSupportOrWarehouse|requireWarehouse/, 'it had no guard at all before');
    const ctrl = read('controllers/supportPartsController.js');
    assert.match(ctrl, /supportPartsScope === 'own' && Number\(challanRes\.rows\[0\]\.issued_to\)/);
  });

  it('the guard resolves through the permission matrix, not a bare role check', () => {
    assert.match(src, /hasPermission\(\s*[\s\S]*?'support_part_challan'/);
  });
});

describe('6.3 U22 — a technician bucket shows your own parts', () => {
  const routes = read('routes/supportParts.js');
  const ctrl = read('controllers/supportPartsController.js');

  it('the bucket route carries a permission guard', () => {
    const line = routeLine(routes, 'get', '/bucket');
    assert.ok(line);
    // A technician reaches their own bucket; non-supervisors are narrowed in the controller.
    assert.match(line, /requireSupportOrWarehouse|requireWarehouse/);
  });

  it('no longer widens to everyone whenever the role is not exactly support_tech', () => {
    assert.ok(
      !/const isTech = req\.user\.role === 'support_tech'/.test(ctrl),
      'the old predicate defaulted to showing the whole floor'
    );
  });

  it('defaults to self-only, and widens only for named supervisor roles', () => {
    assert.match(ctrl, /BUCKET_SUPERVISOR_ROLES/);
    assert.match(ctrl, /if \(!isSupervisor\) \{/);
    // The direction that matters: a role nobody has thought about yet sees only
    // its own bucket rather than everything.
    const m = /const BUCKET_SUPERVISOR_ROLES = new Set\(\[([\s\S]*?)\]\)/.exec(ctrl);
    assert.ok(m, 'the supervisor list must be explicit');
    assert.ok(!/support_tech/.test(m[1]), 'a technician is not a supervisor of the whole floor');
  });
});

describe('6.3 U23 — warehouse-confirm sits above the support gate', () => {
  const src = read('routes/support.js');

  it('declares a (section, action) of its own', () => {
    assert.match(src, /warehouse-confirm'[\s\S]{0,300}?checkAnySectionPermission/);
  });

  it('is still mounted before requireSupportAccess, which is why it needed one', () => {
    const confirmAt = src.indexOf('warehouse-confirm');
    const gateAt = src.indexOf('router.use(requireSupportAccess)');
    assert.ok(confirmAt > 0 && gateAt > 0);
    assert.ok(confirmAt < gateAt, 'the ordering is deliberate — the guard compensates for it');
  });

  it('no longer relies on the controller role list as its only guard', () => {
    assert.ok(
      !/The controller enforces the allowed roles itself\.\s*\n\s*router\.post\('\/items\/:itemId\/warehouse-confirm', confirmWarehouseReceipt\)/.test(src)
    );
  });
});

describe('6.3 U24 — the public support endpoints', () => {
  const routes = read('routes/supportRequestPublic.js');
  const limiter = read('middleware/rateLimit.js');
  const ctrl = read('controllers/supportRequestController.js');

  it('all three public routes are rate limited', () => {
    for (const [verb, path] of [['post', '/request'], ['get', '/pincode/:pin'], ['get', '/ttspl/:code']]) {
      const line = routeLine(routes, verb, path);
      assert.ok(line, `${verb} ${path} must exist`);
      assert.match(line, /Limiter/, `${verb} ${path} must carry a limiter`);
    }
  });

  it('extends the existing limiter rather than adding a second one', () => {
    assert.match(routes, /require\('\.\.\/middleware\/rateLimit'\)/);
    assert.match(limiter, /publicLookupLimiter/);
    assert.match(limiter, /publicIntakeLimiter/);
  });

  it('the lookup budget counts every request, not only failures', () => {
    // skipSuccessfulRequests would make enumeration free again: every guess at a
    // VALID code succeeds, and those are exactly the ones worth counting.
    const block = /const publicLookupLimiter = build\(\{([\s\S]*?)\}\);/.exec(limiter);
    assert.ok(block);
    assert.ok(!/skipSuccessfulRequests/.test(block[1]));
  });

  it('the TTSPL lookup no longer hands out the customer name', () => {
    const fn = ctrl.slice(ctrl.indexOf('lookupPublicTtspl'));
    const response = /return res\.json\(\{\s*success: true,\s*ttspl_id[\s\S]*?\}\);/.exec(fn);
    assert.ok(response, 'the success response must still exist');
    assert.ok(
      !/customer_name/.test(response[0]),
      'an unauthenticated caller with a sequential code could walk the fleet'
    );
    assert.match(response[0], /customer_id/, 'the id is still needed to bind the ticket server-side');
  });
});
