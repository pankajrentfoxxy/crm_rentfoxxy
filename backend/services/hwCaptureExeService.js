const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('RFXYHW01', 'ascii');
const STUB_PATH = path.join(__dirname, '..', 'assets', 'hw-capture', 'rentfoxxy-hw-capture-stub.exe');

const FLOW = {
  'qc2-capture': {
    apiPrefix: 'qc2-capture',
    brand: 'QC2',
    filename: 'rentfoxxy-qc2-verify.exe',
  },
  'dispatch-qc-capture': {
    apiPrefix: 'dispatch-qc-capture',
    brand: 'Dispatch QC',
    filename: 'rentfoxxy-dispatch-qc-verify.exe',
  },
  'grn-capture': {
    apiPrefix: 'grn-capture',
    brand: 'GRN',
    filename: 'rentfoxxy-grn-capture.exe',
  },
};

function getStubPath() {
  return STUB_PATH;
}

function stubExists() {
  try {
    return fs.existsSync(STUB_PATH) && fs.statSync(STUB_PATH).isFile();
  } catch {
    return false;
  }
}

/**
 * Build a per-session Windows EXE: stub bytes + JSON + uint32 LE length + magic.
 * @param {{ apiBase: string, token: string, apiPrefix: string, brand?: string }} opts
 * @returns {{ buffer: Buffer, filename: string, brand: string }}
 */
function buildSessionExe({ apiBase, token, apiPrefix, brand }) {
  const flowKey = String(apiPrefix || '').trim();
  const flow = FLOW[flowKey] || {
    apiPrefix: flowKey,
    brand: brand || 'Hardware',
    filename: 'rentfoxxy-hw-verify.exe',
  };

  if (!stubExists()) {
    const err = new Error(
      'Hardware capture EXE stub is missing on the server. Deploy backend/assets/hw-capture/rentfoxxy-hw-capture-stub.exe'
    );
    err.status = 503;
    throw err;
  }

  const base = String(apiBase || '').replace(/\/$/, '');
  const tok = String(token || '').trim();
  if (!base || !tok) {
    const err = new Error('apiBase and token are required to build the capture EXE');
    err.status = 400;
    throw err;
  }

  const payload = Buffer.from(
    JSON.stringify({
      apiBase: base,
      token: tok,
      apiPrefix: flow.apiPrefix,
      brand: brand || flow.brand,
    }),
    'utf8'
  );

  if (payload.length > 64 * 1024) {
    const err = new Error('Session payload too large');
    err.status = 500;
    throw err;
  }

  const stub = fs.readFileSync(STUB_PATH);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(payload.length, 0);

  return {
    buffer: Buffer.concat([stub, payload, lenBuf, MAGIC]),
    filename: flow.filename,
    brand: brand || flow.brand,
  };
}

module.exports = {
  MAGIC: 'RFXYHW01',
  FLOW,
  getStubPath,
  stubExists,
  buildSessionExe,
};
