#!/usr/bin/env node
/**
 * GRN Serial Capture Agent — run on the RECEIVED LAPTOP (Windows / Mac).
 *
 * Usage (from repo root):
 *   node backend/scripts/grn-serial-capture-agent.js
 *
 * Listens on http://127.0.0.1:19527
 * - GET /serial  → { success, serial_number }
 * - GET /health  → { ok: true }
 *
 * The CRM capture page (opened via link) calls this agent to read the laptop serial
 * without manual typing.
 */
const http = require('http');
const { readHostSerialNumber } = require('../services/hostSerialService');

const PORT = Number(process.env.GRN_CAPTURE_AGENT_PORT || 19527);
const HOST = '127.0.0.1';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'grn-serial-capture-agent' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/serial') {
    const result = readHostSerialNumber();
    if (result && typeof result === 'object' && result.error) {
      sendJson(res, 500, { success: false, message: result.error });
      return;
    }
    if (!result) {
      sendJson(res, 404, { success: false, message: 'Could not read a valid hardware serial on this machine' });
      return;
    }
    sendJson(res, 200, { success: true, serial_number: result });
    return;
  }

  sendJson(res, 404, { success: false, message: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`GRN capture agent listening on http://${HOST}:${PORT}`);
  console.log('Keep this window open while capturing serials on this laptop.');
});
