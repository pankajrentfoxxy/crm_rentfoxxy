/**
 * Procure-to-stock safety, batch C: write actions need edit, and vendor bank
 * details stay with vendor/billing users. Mounts the REAL vendor-management
 * router in-process, signs a real QA user in, and swaps only the permission
 * lookup, so each case controls exactly which grants the user holds.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

// Swap the lookup BEFORE the middleware captures it.
const permissionService = require('../services/permissionService');
let grants = () => false;
permissionService.hasPermission = async (userId, role, section, action) => grants(section, String(action).replace(/^can_/, ''));

const express = require('express');
const pool = require('../config/db');

let server; let base; let token;
const req = (method, p) => new Promise((ok) => {
  const r = http.request(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { j = b; } ok({ code: res.statusCode, body: j }); });
  });
  if (method !== 'GET') r.write('{}');
  r.end();
});

describe('vendor-management write guards', () => {
  before(async () => {
    const u = (await pool.query(
      "SELECT user_id, email, role, COALESCE(token_version, 1) AS tv FROM users WHERE COALESCE(status,'active') = 'active' AND role <> 'super_admin' ORDER BY user_id LIMIT 1"
    )).rows[0];
    token = jwt.sign({ user_id: u.user_id, email: u.email, role: u.role, status: 'active', tv: u.tv, permissions: [] }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const app = express();
    app.use(express.json());
    app.use('/api/vendor-management', require('../routes/vendorManagement'));
    await new Promise((ok) => { server = app.listen(0, ok); });
    base = `http://127.0.0.1:${server.address().port}/api/vendor-management`;
  });
  after(async () => { server.close(); await pool.end(); });

  const viewOnly = (section, action) => action === 'view';

  it('a view-only user can read a return DC but cannot dispatch, complete or cancel it', async () => {
    grants = viewOnly;
    const dc = encodeURIComponent('VRTDC/26-27/9999').replace(/%2F/g, '/');
    assert.notEqual((await req('GET', `/return-to-vendor/dc/${dc}`)).code, 403);
    for (const action of ['dispatch', 'complete', 'cancel', 'request-eway', 'item-values']) {
      assert.equal((await req('POST', `/return-to-vendor/dc/${dc}/${action}`)).code, 403, action);
    }
  });

  it('a view-only user cannot notify a vendor (which stops vendor rent) or cancel a return ticket', async () => {
    grants = viewOnly;
    for (const action of ['notify', 'dc', 'items/cancel', 'cancel']) {
      assert.equal((await req('POST', `/return-ticket/VRT/26-27/9999/${action}`)).code, 403, action);
    }
  });

  it('the e-way upload is refused before any file is written', async () => {
    grants = viewOnly;
    const dir = path.join(__dirname, '..', 'uploads', 'vendor-return-eway');
    const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    assert.equal((await req('POST', '/return-to-vendor/dc/VRTDC/26-27/9999/eway')).code, 403);
    const after = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    assert.equal(after, before);
  });

  it('a debit-notes-only user sees vendors without bank or PAN details', async () => {
    grants = (section, action) => section === 'debit_notes' && action === 'view';
    const r = await req('GET', '/vendors?limit=5');
    assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
    const withBank = (r.body.data || []).filter((v) => v.account_number && v.account_number !== 'hidden');
    assert.equal(withBank.length, 0, 'account numbers must be hidden');
  });

  it('a vendor-management user still sees them (the edit form needs them)', async () => {
    grants = (section, action) => section === 'vendor_management' && action === 'view';
    const r = await req('GET', '/vendors?limit=50');
    assert.equal(r.code, 200);
    assert.ok((r.body.data || []).some((v) => v.account_number && v.account_number !== 'hidden'));
  });
});
