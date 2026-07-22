const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const config = require('./config');

let erpPool = null;
let crmPool = null;

async function getErpPool() {
  if (!erpPool) {
    erpPool = mysql.createPool({
      ...config.erp,
      waitForConnections: true,
      connectionLimit: 10,
      dateStrings: true,
    });
  }
  return erpPool;
}

function getCrmPool() {
  if (!crmPool) {
    crmPool = new Pool(config.crm);
  }
  return crmPool;
}

async function closePools() {
  if (erpPool) {
    await erpPool.end();
    erpPool = null;
  }
  if (crmPool) {
    await crmPool.end();
    crmPool = null;
  }
}

module.exports = { getErpPool, getCrmPool, closePools };
