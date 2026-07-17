const { body, query, validationResult } = require('express-validator');
const pool = require('../../config/db');
const {
  searchLaptopsForMovement,
  bulkMoveAssets
} = require('../../services/inventoryAssetMovementService');

const searchValidators = [
  query('q').notEmpty().trim().isLength({ min: 2, max: 80 })
];

async function searchAssets(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const result = await searchLaptopsForMovement(pool, {
      q: req.query.q,
      limit: req.query.limit
    });
    res.json({ success: true, data: result.data });
  } catch (e) {
    console.error('searchAssetsForMovement', e);
    res.status(500).json({ success: false, message: e.message || 'Search failed' });
  }
}

const bulkMoveValidators = [
  body('serial_ids').isArray({ min: 1, max: 100 }),
  body('serial_ids.*').isInt({ min: 1 }).toInt(),
  body('target').isIn(['qc_pending', 'qc_process', 'passed', 'dead']),
  body('remark').optional().isString().trim()
];

async function bulkMove(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const result = await bulkMoveAssets(
      pool,
      {
        serialIds: req.body.serial_ids,
        target: req.body.target,
        remark: req.body.remark
      },
      req.user?.user_id
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: result.message, data: result.data });
  } catch (e) {
    console.error('bulkMoveAssets', e);
    res.status(500).json({ success: false, message: e.message || 'Bulk move failed' });
  }
}

module.exports = {
  searchValidators,
  searchAssets,
  bulkMoveValidators,
  bulkMove
};
