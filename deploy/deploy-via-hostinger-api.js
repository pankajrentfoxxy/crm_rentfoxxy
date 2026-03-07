#!/usr/bin/env node
/**
 * Deploy Laptop ERP to Hostinger VPS via API
 * 
 * Prerequisites:
 * - Node.js 18+
 * - Hostinger API token (from hPanel → Account → API)
 * - GitHub repo with docker-compose.yaml at root (backend, frontend, deploy/)
 * 
 * Usage:
 *   node deploy-via-hostinger-api.js
 *   API_TOKEN=xxx node deploy-via-hostinger-api.js
 * 
 * Required env vars (or edit below):
 *   API_TOKEN       - Hostinger API token
 *   GITHUB_REPO     - e.g. https://github.com/pankajrentfoxxy/laptop-refurbishment
 *   VIRTUAL_MACHINE_ID - Your VPS ID (run without it to list VMs first)
 *   PROJECT_NAME    - e.g. laptop-erp
 *   ENV_FILE        - Path to .env file for environment variables
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://developers.hostinger.com';

// === CONFIG (override via env) ===
const API_TOKEN = process.env.API_TOKEN || process.env.HOSTINGER_API_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'https://github.com/pankajrentfoxxy/laptop-refurb-backend';
const VIRTUAL_MACHINE_ID = process.env.VIRTUAL_MACHINE_ID;
const PROJECT_NAME = process.env.PROJECT_NAME || 'laptop-erp';
const ENV_FILE = process.env.ENV_FILE || path.join(__dirname, '..', 'laptop-erp-deploy', '.env');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      opts.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => data += ch);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`API ${res.statusCode}: ${JSON.stringify(parsed)}`));
          }
        } catch (e) {
          reject(new Error(`Response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const env = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      env[key] = val;
    }
  }
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
}

async function getVirtualMachines() {
  const res = await request('GET', '/api/vps/v1/virtual-machines');
  return res.data || res.virtual_machines || res;
}

async function createProject(vmId, projectName, content, environment) {
  const body = { project_name: projectName, content };
  if (environment) body.environment = environment;
  return request('POST', `/api/vps/v1/virtual-machines/${vmId}/docker`, body);
}

async function main() {
  if (!API_TOKEN) {
    console.error('ERROR: Set API_TOKEN or HOSTINGER_API_TOKEN');
    console.error('  Get token from: hPanel → Account → API');
    process.exit(1);
  }

  // Step 1: Get virtual machine ID if not provided
  let vmId = VIRTUAL_MACHINE_ID;
  if (!vmId) {
    console.log('Fetching virtual machines...');
    const vms = await getVirtualMachines();
    const list = Array.isArray(vms) ? vms : (vms.virtual_machines || vms.data || []);
    if (!list.length) {
      console.error('No VPS found. Create a VPS in Hostinger first.');
      process.exit(1);
    }
    vmId = list[0].id ?? list[0].virtual_machine_id;
    console.log(`Using VM ID: ${vmId} (${list[0].hostname || list[0].ip || 'N/A'})`);
  }

  // Step 2: Load environment
  const environment = loadEnvFile(ENV_FILE);
  if (!environment) {
    console.warn('WARN: No .env file found. Create deploy/.env from .env.example');
  }

  // Step 3: Deploy
  console.log(`Deploying ${PROJECT_NAME} from ${GITHUB_REPO}...`);
  const result = await createProject(vmId, PROJECT_NAME, GITHUB_REPO, environment || undefined);
  console.log('Deployment initiated:', JSON.stringify(result, null, 2));
  console.log('\nDeployment may take 5-10 minutes (Docker build).');
  console.log('Check status in hPanel or run: API_TOKEN=xxx VIRTUAL_MACHINE_ID=' + vmId + ' node deploy-via-hostinger-api.js --status');
  console.log('\nAfter deployment, restore Supabase backup (see deploy/HOSTINGER_DEPLOY.md)');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
