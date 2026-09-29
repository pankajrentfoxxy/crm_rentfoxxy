/**
 * Customer profile / documents / portal in the new customer record
 * (Builder 10 — claude/carret-remaining-build.md wave 2).
 *
 * Real handlers inside one transaction that is rolled back
 * (test/helpers/rollbackHarness), so nothing is left in the database.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/rollbackHarness');

const ADMIN = { user_id: 2, role: 'admin', name: 'Admin' };
const FULL = ['sales', 'rental', 'both'];
const SALES_ONLY = ['sales', 'both'];

let db;
let ctrl;
let docs;
let seq = 0;

async function customer({ type = 'rental', billingState = 'Haryana', shippingState = null, email, pan = null } = {}) {
  seq += 1;
  const r = await db.query(
    `INSERT INTO customers (name, company_name, customer_type, customer_type_source, billing_state, shipping_state,
                            shipping_same, email, pan_number, details)
     VALUES ($1, $1, $2, 'manual', $3, $4, $5, $6, $7, '{}'::jsonb) RETURNING customer_id`,
    [`Profile test ${Date.now()}-${seq}`, type, billingState, shippingState, shippingState == null,
      email || `profile-test-${Date.now()}-${seq}@example.invalid`, pan]
  );
  return r.rows[0].customer_id;
}

/** Call a handler as a user whose Customer Access resolves to `allowed`. */
const as = (fn, allowed = FULL) => (req, res) => { req.allowedCustomerTypes = allowed; req.protocol = 'http'; req.get = () => 'test'; return fn(req, res); };

before(async () => {
  db = await H.open();
  // QA lacks migration 192; live has it. Created inside the rolled-back
  // transaction so the portal paths run against the real shape.
  await db.query(`CREATE TABLE IF NOT EXISTS auth_credentials (
    id SERIAL PRIMARY KEY, email TEXT NOT NULL,
    email_lower TEXT GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,
    password_hash TEXT NOT NULL, portal TEXT NOT NULL CHECK (portal IN ('crm', 'vendor', 'customer')),
    entity_id INTEGER NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT auth_credentials_email_lower_unique UNIQUE (email_lower))`);
  ctrl =require('../controllers/customerManagementController');
  docs = require('../controllers/customerDocumentController');
});
after(async () => { await H.close(); });

describe('Customer Access scope on single-customer endpoints', () => {
  it('refuses a rental customer to a sales-only user, and allows an in-scope one', async () => {
    const rental = await customer({ type: 'rental' });
    const sales = await customer({ type: 'sales' });
    const addr = (await db.query(
      `INSERT INTO customer_addresses (customer_id, address, city, is_head_office, address_type)
       VALUES ($1, 'Test street', 'Gurugram', false, 'Shipping') RETURNING customer_address_id`, [rental]
    )).rows[0].customer_address_id;
    const doc = (await db.query(
      `INSERT INTO customer_documents (customer_id, doc_type, file_path, file_name, uploaded_by)
       VALUES ($1, 'pan_card', 'uploads/customer-documents/none.pdf', 'none.pdf', 2) RETURNING doc_id`, [rental]
    )).rows[0].doc_id;

    const out = [
      ['getCustomer', ctrl.getCustomer, { customerId: rental }, {}],
      ['updateCustomer', ctrl.updateCustomer, { customerId: rental }, { notes: 'x' }],
      ['updateCustomerAddress', ctrl.updateCustomerAddress, { customerId: rental, addressId: addr }, { address: 'New' }],
      ['deleteCustomerAddress', ctrl.deleteCustomerAddress, { customerId: rental, addressId: addr }, {}],
      ['setDefaultCustomerAddress', ctrl.setDefaultCustomerAddress, { customerId: rental, addressId: addr }, {}],
      ['verifyCustomerKyc', ctrl.verifyCustomerKyc, { customerId: rental }, {}],
      ['enableCustomerPortal', ctrl.enableCustomerPortal, { customerId: rental }, { enabled: true }],
      ['listDocuments', docs.listDocuments, { customerId: rental }, {}],
      ['deleteDocument', docs.deleteDocument, { customerId: rental, docId: doc }, {}],
    ];
    for (const [name, fn, params, body] of out) {
      const r = await H.call(as(fn, SALES_ONLY), { params, body, user: ADMIN });
      assert.equal(r.code, 403, `${name} must refuse an out-of-scope customer (got ${r.code})`);
    }
    // Nothing changed behind the refusals.
    assert.equal((await db.query('SELECT kyc_verified FROM customers WHERE customer_id = $1', [rental])).rows[0].kyc_verified, false);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM customer_documents WHERE doc_id = $1', [doc])).rows[0].n, 1);
    assert.equal((await db.query('SELECT address FROM customer_addresses WHERE customer_address_id = $1', [addr])).rows[0].address, 'Test street');

    const ok = await H.call(as(docs.listDocuments, SALES_ONLY), { params: { customerId: sales }, user: ADMIN });
    assert.equal(ok.code, 200);
    const kyc = await H.call(as(ctrl.verifyCustomerKyc, SALES_ONLY), { params: { customerId: sales }, user: ADMIN });
    assert.equal(kyc.code, 200);
  });

  it('account closure refuses an out-of-scope customer', async () => {
    const overview = require('../controllers/customerOverviewController');
    const rental = await customer({ type: 'rental' });
    const r = await H.call(as(overview.closeAccount, SALES_ONLY), { params: { customerId: rental }, body: { note: 'closing it' }, user: ADMIN });
    assert.equal(r.code, 404);
    assert.equal((await db.query('SELECT closed_at FROM customers WHERE customer_id = $1', [rental])).rows[0].closed_at, null);
  });

  it('set-default leaves exactly one default address', async () => {
    const c = await customer();
    const ids = [];
    for (const head of [true, false]) {
      ids.push((await db.query(
        `INSERT INTO customer_addresses (customer_id, address, is_head_office) VALUES ($1, 'A', $2) RETURNING customer_address_id`,
        [c, head]
      )).rows[0].customer_address_id);
    }
    const r = await H.call(as(ctrl.setDefaultCustomerAddress), { params: { customerId: c, addressId: ids[1] }, user: ADMIN });
    assert.equal(r.code, 200);
    const heads = r.body.addresses.filter((a) => a.is_head_office).map((a) => a.customer_address_id);
    assert.deepEqual(heads, [ids[1]]);
  });
});

describe('Profile edit (PUT /customers/:id)', () => {
  it('a partial edit (the admin tag) no longer needs the spoke person repeated', async () => {
    const c = await customer({ type: 'rental' });
    const r = await H.call(as(ctrl.updateCustomer), {
      params: { customerId: c }, body: { customer_type: 'both', customer_type_reason: 'test' }, user: ADMIN,
    });
    assert.equal(r.code, 200, r.body?.message);
    assert.equal(r.body.customer.customer_type, 'both');
  });

  it('still requires the spoke person when the contact block is sent', async () => {
    const c = await customer();
    const r = await H.call(as(ctrl.updateCustomer), {
      params: { customerId: c }, body: { finance_contact_name: 'F', spock_person_name: '' }, user: ADMIN,
    });
    assert.equal(r.code, 400);
    assert.match(r.body.message, /Spoke person/);
  });

  it('checks GSTIN, PAN and email when they change', async () => {
    const c = await customer();
    const bad = async (body) => H.call(as(ctrl.updateCustomer), { params: { customerId: c }, body, user: ADMIN });
    assert.equal((await bad({ gst_number: '06AAHCT0310' })).code, 400);
    assert.equal((await bad({ gst_number: '06AAHCT0310N1XG' })).code, 400);
    assert.equal((await bad({ pan_number: 'ABCDE12345' })).code, 400);
    assert.equal((await bad({ email: 'not-an-email' })).code, 400);
    assert.equal((await bad({ email: '' })).code, 400);
    const good = await bad({ gst_number: '06aahct0310n1zg', pan_number: 'aahct0310n' });
    assert.equal(good.code, 200, good.body?.message);
    assert.equal(good.body.customer.gst_number, '06AAHCT0310N1ZG');
    assert.equal(good.body.customer.pan_number, 'AAHCT0310N');
  });

  it('a legacy bad PAN already on file does not block an unrelated edit', async () => {
    const c = await customer({ pan: 'NA' });
    const r = await H.call(as(ctrl.updateCustomer), {
      params: { customerId: c }, body: { notes: 'hello', pan_number: 'NA' }, user: ADMIN,
    });
    assert.equal(r.code, 200, r.body?.message);
  });

  it('a change to the GST supply state needs an explicit confirmation', async () => {
    const c = await customer({ billingState: 'Haryana' });
    const first = await H.call(as(ctrl.updateCustomer), {
      params: { customerId: c }, body: { billing_state: 'Karnataka' }, user: ADMIN,
    });
    assert.equal(first.code, 409);
    assert.equal(first.body.code, 'SUPPLY_STATE_CHANGE');
    assert.equal(first.body.from_state, 'Haryana');
    assert.equal(first.body.to_state, 'Karnataka');
    assert.equal((await db.query('SELECT billing_state FROM customers WHERE customer_id = $1', [c])).rows[0].billing_state, 'Haryana');

    const second = await H.call(as(ctrl.updateCustomer), {
      params: { customerId: c }, body: { billing_state: 'Karnataka', confirm_supply_state_change: true }, user: ADMIN,
    });
    assert.equal(second.code, 200, second.body?.message);
    assert.equal(second.body.customer.billing_state, 'Karnataka');
  });

  it('the same state spelt differently is not a change', async () => {
    const c = await customer({ billingState: 'haryana' });
    const r = await H.call(as(ctrl.updateCustomer), { params: { customerId: c }, body: { billing_state: 'Haryana' }, user: ADMIN });
    assert.equal(r.code, 200, r.body?.message);
  });

  it('a differing shipping state is what billing uses, and is guarded too', async () => {
    const c = await customer({ billingState: 'Haryana' });
    const r = await H.call(as(ctrl.updateCustomer), {
      params: { customerId: c },
      body: { shipping_same: false, shipping_address: 'X', shipping_city: 'Pune', shipping_state: 'Maharashtra', shipping_pincode: '411001' },
      user: ADMIN,
    });
    assert.equal(r.code, 409);
    assert.equal(r.body.to_state, 'Maharashtra');
  });

  it('"same as billing" stores NULL shipping fields, not empty strings', async () => {
    const c = await customer({ billingState: 'Haryana' });
    const r = await H.call(as(ctrl.updateCustomer), {
      params: { customerId: c },
      body: { shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: '' },
      user: ADMIN,
    });
    assert.equal(r.code, 200, r.body?.message);
    const row = (await db.query('SELECT shipping_state, shipping_address FROM customers WHERE customer_id = $1', [c])).rows[0];
    assert.equal(row.shipping_state, null);
    assert.equal(row.shipping_address, null);
  });

  it('an email change moves the portal sign-in with it', async () => {
    const c = await customer({ email: `old-${Date.now()}@example.invalid` });
    const oldEmail = (await db.query('SELECT email FROM customers WHERE customer_id = $1', [c])).rows[0].email;
    await db.query(
      `INSERT INTO auth_credentials (email, password_hash, portal, entity_id, enabled) VALUES ($1, 'x', 'customer', $2, true)`,
      [oldEmail, c]
    );
    const newEmail = `new-${Date.now()}@example.invalid`;
    const r = await H.call(as(ctrl.updateCustomer), { params: { customerId: c }, body: { email: newEmail }, user: ADMIN });
    assert.equal(r.code, 200, r.body?.message);
    const cred = (await db.query(`SELECT email FROM auth_credentials WHERE portal = 'customer' AND entity_id = $1`, [c])).rows;
    assert.deepEqual(cred.map((x) => x.email), [newEmail]);
  });
});

describe('Portal access', () => {
  it('a password reset returns the new password once and ends old sessions', async () => {
    const c = await customer();
    const on = await H.call(as(ctrl.enableCustomerPortal), { params: { customerId: c }, body: { enabled: true }, user: ADMIN });
    assert.equal(on.code, 200, on.body?.message);
    assert.ok(on.body.new_password && on.body.new_password.length >= 10, 'first enable hands over a password');
    await db.query(
      `INSERT INTO customer_portal_sessions (customer_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [c, `test-token-${Date.now()}`]
    );
    const reset = await H.call(as(ctrl.enableCustomerPortal), { params: { customerId: c }, body: { reset_password: true }, user: ADMIN });
    assert.equal(reset.code, 200);
    assert.ok(reset.body.new_password);
    assert.notEqual(reset.body.new_password, on.body.new_password);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM customer_portal_sessions WHERE customer_id = $1', [c])).rows[0].n, 0);

    // Re-enabling with a password on file does not mint (or show) another one.
    const again = await H.call(as(ctrl.enableCustomerPortal), { params: { customerId: c }, body: { enabled: true }, user: ADMIN });
    assert.equal(again.body.new_password, undefined);

    // The customer record never carries the hash.
    const view = await H.call(as(ctrl.getCustomer), { params: { customerId: c }, user: ADMIN });
    assert.equal(JSON.stringify(view.body).includes('portal_password_hash'), false);
  });

  it('disabling turns the sign-in credential off as well', async () => {
    const c = await customer();
    await H.call(as(ctrl.enableCustomerPortal), { params: { customerId: c }, body: { enabled: true }, user: ADMIN });
    const off = await H.call(as(ctrl.enableCustomerPortal), { params: { customerId: c }, body: { enabled: false }, user: ADMIN });
    assert.equal(off.code, 200);
    const cred = (await db.query(`SELECT enabled FROM auth_credentials WHERE portal = 'customer' AND entity_id = $1`, [c])).rows;
    assert.ok(cred.every((x) => x.enabled === false));
    assert.equal((await db.query('SELECT portal_enabled FROM customers WHERE customer_id = $1', [c])).rows[0].portal_enabled, false);
  });
});
