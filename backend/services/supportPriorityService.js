'use strict';

const MATRIX = {           // [impact][urgency] → priority
  1: { 1: 1, 2: 2, 3: 3 },
  2: { 1: 2, 2: 3, 3: 4 },
  3: { 1: 3, 2: 4, 3: 4 },
};

/**
 * @param {object} p
 * @param {1|2|3} p.impact
 * @param {1|2|3} p.urgency
 * @param {string} [p.supportTier]      PLATINUM | GOLD | SILVER | STANDARD
 * @param {boolean} [p.isSafety]
 * @param {boolean} [p.isRepeat]
 * @param {boolean} [p.isReopen]
 * @param {boolean} [p.contactIsVip]
 * @param {boolean} [p.isSlaComplaint]  issue type is SVC-SLA
 * @param {number}  [p.fleetSize]
 * @param {number}  [p.affectedUnits]
 * @returns {{ priority:number, reasons:string[] }}
 */
function computePriority(p) {
  const reasons = [];
  let priority = MATRIX[p.impact]?.[p.urgency];
  if (!priority) throw Object.assign(new Error('Invalid impact/urgency'), { status: 400 });
  reasons.push(`Impact ${p.impact} × Urgency ${p.urgency} → P${priority}`);

  const bump = (label) => {
    if (priority > 1) { priority -= 1; reasons.push(`${label}: −1 → P${priority}`); }
    else reasons.push(`${label}: already P1`);
  };

  if (p.supportTier === 'PLATINUM') bump('Platinum customer');
  else if (p.supportTier === 'GOLD' && priority >= 3) bump('Gold customer');
  if (p.isRepeat) bump('Repeat complaint');
  if (p.isReopen) bump('Reopened ticket');
  if (p.contactIsVip) bump('VIP contact');

  if (p.isSafety)       { priority = 1; reasons.push('Safety issue: forced P1'); }
  if (p.isSlaComplaint) { priority = 1; reasons.push('SLA breach complaint: forced P1'); }
  if ((p.fleetSize || 0) >= 200 && (p.affectedUnits || 0) >= 10) {
    priority = 1; reasons.push('Large fleet, ≥10 units affected: forced P1');
  }
  return { priority, reasons };
}

module.exports = { computePriority, MATRIX };
