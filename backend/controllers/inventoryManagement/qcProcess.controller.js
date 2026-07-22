const { body, validationResult } = require('express-validator');
const pool = require('../../config/db');
const {
  addLaptopToQcProcess,
  movePassedSerialToQcProcess,
  moveQcPendingToQcProcess,
  moveDeadOrFailedToQcProcess,
  createProductionTicketForQcSerial,
  PO_TYPES
} = require('../../services/qcProcessIntakeService');

const addLaptopValidators = [
  body('serial_number').notEmpty().trim(),
  body('vendor_id').isInt({ min: 1 }).toInt(),
  body('brand').notEmpty().trim(),
  body('model').notEmpty().trim(),
  body('processor').notEmpty().trim(),
  body('ram').notEmpty().trim(),
  body().custom((value, { req }) => {
    if (!String(req.body.storage || req.body.ssd || '').trim()) {
      throw new Error('storage (SSD) is required');
    }
    return true;
  }),
  body('purchase_order_type').optional().isIn(PO_TYPES),
  body('purchase_order_date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  body('rental_start_date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  body('po_state').optional().isString().trim(),
  body('inventory_asset_code').optional().isString().trim(),
  body('asset_tag').optional().isString().trim(),
  body('purchase_order_number').optional().isString().trim(),
  body('generation').optional().isString().trim(),
  body('gpu').optional().isString().trim(),
  body('screen_size').optional().isString().trim(),
  body('os').optional().isString().trim(),
  body('unit_price').optional().isFloat({ min: 0 }),
  body('purchase_amount').optional().isFloat({ min: 0 }),
  body('remarks').optional().isString(),
  body('intake_target').optional().isIn(['qc_pending', 'pending'])
];

async function addLaptop(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const result = await addLaptopToQcProcess(pool, req.body, req.user?.user_id);
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    const ticketId = result.data.ticket?.ticket_id;
    const isPending = result.data.qc_status === 'qc_pending';
    res.status(201).json({
      success: true,
      message: ticketId
        ? `Laptop added to QC Process. Floor ticket #${ticketId} created.`
        : isPending
          ? 'Laptop added to QC Pending.'
          : 'Laptop added to QC Process.',
      data: result.data
    });
  } catch (e) {
    console.error('addLaptopToQcProcess', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to add laptop' });
  }
}

const moveToQcValidators = [
  body('serial_number_id').isInt({ min: 1 }).toInt(),
  body('serial_number').notEmpty().trim()
];

async function moveToQcProcess(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const result = await movePassedSerialToQcProcess(
      pool,
      {
        serialId: req.body.serial_number_id,
        serialNumber: String(req.body.serial_number).trim()
      },
      req.user?.user_id
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: result.message, data: result.data });
  } catch (e) {
    console.error('moveToQcProcess', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to move to QC Process' });
  }
}

const moveFromQcPendingValidators = [
  body('serial_number_id').isInt({ min: 1 }).toInt(),
  body('serial_number').notEmpty().trim()
];

async function moveFromQcPending(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const result = await moveQcPendingToQcProcess(
      pool,
      {
        serialId: req.body.serial_number_id,
        serialNumber: String(req.body.serial_number).trim()
      },
      req.user?.user_id
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: result.message, data: result.data });
  } catch (e) {
    console.error('moveFromQcPending', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to move to QC Process' });
  }
}

const moveDeadToQcValidators = [
  body('serial_number_id').isInt({ min: 1 }).toInt(),
  body('serial_number').notEmpty().trim()
];

async function moveDeadToQcProcess(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const result = await moveDeadOrFailedToQcProcess(
      pool,
      {
        serialId: req.body.serial_number_id,
        serialNumber: String(req.body.serial_number).trim()
      },
      req.user?.user_id
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: result.message, data: result.data });
  } catch (e) {
    console.error('moveDeadToQcProcess', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to move to QC Process' });
  }
}

const createProductionTicketValidators = [
  body('serial_number_id').isInt({ min: 1 }).toInt(),
  body('serial_number').notEmpty().trim()
];

async function createProductionTicket(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const result = await createProductionTicketForQcSerial(
      pool,
      {
        serialId: req.body.serial_number_id,
        serialNumber: String(req.body.serial_number).trim()
      },
      req.user?.user_id
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({
        success: false,
        message: result.message,
        data: result.data
      });
    }
    res.status(201).json({ success: true, message: result.message, data: result.data });
  } catch (e) {
    console.error('createProductionTicket', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to create Production ticket' });
  }
}

module.exports = {
  addLaptopValidators,
  addLaptop,
  moveToQcValidators,
  moveToQcProcess,
  moveFromQcPendingValidators,
  moveFromQcPending,
  moveDeadToQcValidators,
  moveDeadToQcProcess,
  createProductionTicketValidators,
  createProductionTicket
};
