const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/guardGateController');

const view = checkSectionPermission('guard_gate_checking', 'view');
const create = checkSectionPermission('guard_gate_checking', 'create');

router.use(authMiddleware);

router.get('/dashboard', view, ctrl.dashboard);
router.get('/history', view, ctrl.history);

// Part 3.2 — the pre-flight, asked BEFORE the guard scans.
//
// The gate refuses on submit, but a guard who has already scanned twelve units
// and is then told the e-way bill is missing has wasted the scan. This answers
// the same question up front so the screen can show which check failed and who
// to call, with the challan still sitting at dispatch_ready.
router.get('/preflight/:dcNumber', view, async (req, res) => {
  try {
    const pool = require('../config/db');
    const { runGatePreflight } = require('../services/gatePreflightService');

    const { rows } = await pool.query(
      `SELECT status, awb_number, porter_tracking_id, eway_required, eway_bill_number,
              eway_asset_value, dispatch_mode, ship_by
         FROM delivery_challan_lines
        WHERE dc_number = $1
        LIMIT 1`,
      [req.params.dcNumber]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }

    // Read-only: this must never write a gate_refused event, because nothing
    // has been refused yet — the guard is only looking. Only the real submit
    // records a refusal.
    const result = await runGatePreflight(pool, {
      dcNumber: req.params.dcNumber,
      head: rows[0],
      // record:false — nothing has been refused yet, the guard is only looking.
      // Only the real submit writes a gate_refused event.
      record: false,
    });

    res.json({ success: true, dc_number: req.params.dcNumber, ok: result.ok, failures: result.failures });
  } catch (err) {
    console.error('gate preflight:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});
router.get('/report', view, ctrl.report);
router.get('/report/column-values', view, ctrl.reportColumnValues);
router.post('/resolve', create, ctrl.resolve);
router.get('/sessions/:sessionId', view, ctrl.getSession);
router.post('/sessions/:sessionId/scan', create, ctrl.scanUnit);
router.post('/sessions/:sessionId/confirm', create, ctrl.confirm);

module.exports = router;
