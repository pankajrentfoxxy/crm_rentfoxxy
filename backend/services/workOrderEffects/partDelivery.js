'use strict';

async function onCreate() { return null; }
async function onAssign() { return null; }
async function onCancel() { return null; }
async function onStep() { return null; }

async function onComplete(client, wo, body = {}) {
  const { requestByWo, consumePart } = require('../supportPartsService');
  const req = await requestByWo(client, wo.wo_id);
  if (!req || req.status_v2 === 'CONSUMED') return { request_id: req && req.request_id };
  if (!['ISSUED', 'IN_TRANSIT', 'DELIVERED', 'RESERVED'].includes(req.status_v2)) {
    return { request_id: req.request_id, status_v2: req.status_v2 };
  }
  return consumePart(client, req.request_id, body, body.userId || wo.assigned_to);
}

module.exports = { onCreate, onAssign, onComplete, onCancel, onStep };
