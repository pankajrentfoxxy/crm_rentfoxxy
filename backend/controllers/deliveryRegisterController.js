const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../config/db');

const {emailDocument} = require('../services/salesManagementPdfService');
const {
  getDeliveryRegisterCounts,
  listDeliveryRegister,
  listDeliveryTechnicians,
  listDeliveryPersonOptions,
  changeDeliveryPerson,
  parseJsonArray,
} = require('../services/deliveryRegisterService');
const technicianService = require('../services/deliveryTechnicianService');
const { loginAsTechnician } = require('../services/technicianAuthService');

const podUploadDir = path.join(__dirname, '..', '..', 'uploads', 'pod_files');
if (!fs.existsSync(podUploadDir)) {
  fs.mkdirSync(podUploadDir, { recursive: true });
}

const safeFilename = (_req, file, cb) => {
  const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  cb(null, `${Date.now()}_${safe}`);
};

const podUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, podUploadDir),
    filename: safeFilename,
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
});

const technicianUploadDir = path.join(__dirname, '..', '..', 'uploads', technicianService.UPLOAD_SUBDIR);
if (!fs.existsSync(technicianUploadDir)) {
  fs.mkdirSync(technicianUploadDir, { recursive: true });
}

const technicianUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, technicianUploadDir),
    filename: safeFilename,
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
});

function parseProductsField(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [raw];
    } catch {
      return raw ? [raw] : [];
    }
  }
  return [];
}

function extractSerialValues(products) {
  return products.map((item) => {
    if (typeof item === 'string') {
      try {
        const obj = JSON.parse(item);
        return obj.serial || item;
      } catch {
        return item;
      }
    }
    return item?.serial || String(item);
  });
}

exports.getCounts = async (_req, res) => {
  try {
    const counts = await getDeliveryRegisterCounts();
    res.json({ success: true, counts });
  } catch (e) {
    console.error('deliveryRegister getCounts', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = (req.query.search || '').trim();
    const data = await listDeliveryRegister({ status, page, limit, search });
    const deliveryPersons = await listDeliveryPersonOptions();
    res.json({ success: true, ...data, delivery_persons: deliveryPersons });
  } catch (e) {
    console.error('deliveryRegister listByStatus', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.changeDeliveryPerson = async (req, res) => {
  try {
    const { dc_number, delivery_person_id, ship_by, courier_name, awb_number } = req.body;
    if (!dc_number) {
      return res.status(400).json({ success: false, message: 'dc_number is required' });
    }
    const result = await changeDeliveryPerson({
      dcNumber: dc_number,
      deliveryPersonId: delivery_person_id,
      shipBy: ship_by,
      courierName: courier_name,
      awbNumber: awb_number,
    });
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: 'Delivery person updated successfully' });
  } catch (e) {
    console.error('changeDeliveryPerson', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.sendOtp = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await pool.query(
      `UPDATE delivery_challan_lines SET d_otp = $1, d_customer_email = $2, d_customer_name = $3, updated_at = NOW()
       WHERE dc_number = $4`,
      [otp, email, name || null, dcNumber]
    );
    await emailDocument({
      to: email,
      subject: `Delivery OTP for ${dcNumber}`,
      text: `Your delivery OTP is ${otp}`,
      pdfRelativePath: null,
    });
    res.json({ success: true, status: 'success', message: 'OTP sent successfully' });
  } catch (e) {
    res.status(500).json({ success: false, status: 'error', message: e.message });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const { otp } = req.body;
    const r = await pool.query(
      `SELECT d_otp FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [dcNumber]
    );
    if (!r.rows.length || r.rows[0].d_otp !== String(otp)) {
      return res.status(400).json({ success: false, status: 'error', message: 'Invalid OTP' });
    }
    await pool.query(
      `UPDATE delivery_challan_lines SET d_otp_verified_at = NOW(), updated_at = NOW() WHERE dc_number = $1`,
      [dcNumber]
    );
    res.json({ success: true, status: 'success', message: 'OTP verified successfully' });
  } catch (e) {
    res.status(500).json({ success: false, status: 'error', message: e.message });
  }
};

exports.submitPod = [
  podUpload.array('files', 10),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const dcNumber = req.body.dc_number || req.params.dcNumber;
      if (!dcNumber) {
        return res.status(400).json({ success: false, message: 'dc_number is required' });
      }

      const linesR = await client.query(
        `SELECT * FROM delivery_challan_lines WHERE dc_number = $1 ORDER BY id`,
        [dcNumber]
      );
      if (!linesR.rows.length) {
        return res.status(404).json({ success: false, message: 'Delivery challan not found' });
      }

      const otpCheck = await client.query(
        `SELECT d_otp_verified_at FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
        [dcNumber]
      );
      if (!otpCheck.rows[0]?.d_otp_verified_at) {
        return res.status(400).json({ success: false, message: 'Please verify OTP before submitting POD' });
      }

      const deliveredRaw = parseProductsField(req.body.delivered_products);
      const rejectedRaw = parseProductsField(req.body.rejected_products);
      const deliveredSerials = extractSerialValues(deliveredRaw);
      const rejectedSerials = extractSerialValues(rejectedRaw);

      if (!deliveredSerials.length && !rejectedSerials.length) {
        return res.status(400).json({ success: false, message: 'Select delivered or rejected products' });
      }

      const filePaths = (req.files || []).map((f) => `pod_files/${f.filename}`);
      const remark = req.body.remark || req.body.podRemark || req.body.submitted_remark || '';
      const submittedName = req.body.name || req.body.submitted_name || null;
      const personId = req.body.person_id || req.body.submitted_person_id || req.user?.user_id || null;
      const personType = req.body.person_type || req.body.submitted_person_type || 'admin';
      const dateTime = req.body.datetime || req.body.podDateTime || new Date().toISOString();
      const latitude = req.body.latitude || null;
      const longitude = req.body.longitude || null;
      const mobile = req.body.mobile || req.body.d_customer_mobile || null;

      let nextStatus = 'processing';
      if (deliveredSerials.length && !rejectedSerials.length) nextStatus = 'delivered';
      else if (rejectedSerials.length && !deliveredSerials.length) nextStatus = 'rejected';
      else if (deliveredSerials.length && rejectedSerials.length) nextStatus = 'delivered';

      await client.query('BEGIN');

      for (const line of linesR.rows) {
        const lineSerials = parseJsonArray(line.serial_number);
        const lineDelivered = lineSerials.filter((s) => deliveredSerials.includes(s));
        const lineRejected = lineSerials.filter((s) => rejectedSerials.includes(s));

        await client.query(
          `UPDATE delivery_challan_lines SET
             delivered_serial_numbers = $1::jsonb,
             rejected_serial_numbers = $2::jsonb,
             submitted_remark = $3,
             submitted_name = $4,
             submitted_person_id = $5,
             submitted_person_type = $6,
             date_and_time = $7::timestamptz,
             latitude = $8,
             longitude = $9,
             d_customer_mobile = COALESCE($10, d_customer_mobile),
             file_path = COALESCE($11::text, file_path),
             status = $12::varchar,
             delivery_completed_at = CASE WHEN $12::varchar = 'delivered' THEN NOW() ELSE delivery_completed_at END,
             updated_at = NOW()
           WHERE id = $13`,
          [
            JSON.stringify(lineDelivered.length ? lineDelivered : deliveredSerials),
            JSON.stringify(lineRejected.length ? lineRejected : rejectedSerials),
            remark,
            submittedName,
            personId,
            personType,
            dateTime,
            latitude,
            longitude,
            mobile,
            filePaths.length ? JSON.stringify(filePaths) : null,
            nextStatus,
            line.id,
          ]
        );
      }

      // Return DC completed by courier/porter (warehouse uploaded POD): fire the
      // return lifecycle (mark returned -> QC re-entry -> credit note).
      if (nextStatus === 'delivered') {
        const mv = await client.query(
          `SELECT movement_type, support_ticket_id FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
          [dcNumber]
        );
        if (mv.rows[0]?.movement_type === 'return') {
          const idsRes = await client.query(
            `SELECT serial_id FROM vendor_serial_numbers
              WHERE deleted_at IS NULL
                AND (serial_number = ANY($1::text[]) OR inventory_asset_code = ANY($1::text[]))`,
            [deliveredSerials.length ? deliveredSerials : ['']]
          );
          const returnSvc = require('../services/returnCompletionService');
          await returnSvc.processReturnedSerials(client, {
            serialIds: idsRes.rows.map((r) => r.serial_id),
            dcNumber,
            supportTicketId: mv.rows[0].support_ticket_id || null,
            actorUserId: req.user?.user_id || null,
            actorName: req.user?.name || null,
          });
        }
      }

      await client.query('COMMIT');
      res.json({ success: true, message: 'Delivery status updated successfully' });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* ignore */
      }
      console.error('submitPod', e);
      res.status(500).json({ success: false, message: e.message || 'POD upload failed' });
    } finally {
      client.release();
    }
  },
];

exports.getTechnicianAddMeta = async (_req, res) => {
  try {
    res.json({ success: true, generated_password: technicianService.generatePassword() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listTechnicians = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const search = (req.query.search || '').trim();
    const result = await technicianService.listTechnicians({ page, limit, search });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getTechnician = async (req, res) => {
  try {
    const data = await technicianService.getTechnicianById(Number(req.params.id));
    if (!data) return res.status(404).json({ success: false, message: 'Technician not found' });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.createTechnician = [
  technicianUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'identity_image', maxCount: 5 },
  ]),
  async (req, res) => {
    try {
      const result = await technicianService.createTechnician(req.body, req.files || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      if (result.data?.email && result.plainPassword) {
        try {
          await emailDocument({
            to: result.data.email,
            subject: 'Your technician account',
            text: `Hello ${result.data.first_name},\n\nYour technician account has been created.\nEmail: ${result.data.email}\nPassword: ${result.plainPassword}\n\nPlease log in and change your password.`,
            pdfRelativePath: null,
          });
        } catch (mailErr) {
          console.error('technician welcome email', mailErr);
        }
      }
      res.status(201).json({ success: true, data: result.data, message: 'Technician added successfully' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  },
];

exports.updateTechnician = [
  technicianUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'identity_image', maxCount: 5 },
  ]),
  async (req, res) => {
    try {
      const result = await technicianService.updateTechnician(
        Number(req.params.id),
        req.body,
        req.files || {}
      );
      if (!result.ok) {
        return res.status(result.status || 400).json({ success: false, message: result.message });
      }
      res.json({ success: true, data: result.data, message: 'Technician updated successfully' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  },
];

exports.updateTechnicianStatus = async (req, res) => {
  try {
    const { id, status } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'id is required' });
    const result = await technicianService.updateTechnicianStatus(id, status);
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, data: result.data, message: 'Status updated successfully' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.loginAsTechnician = async (req, res) => {
  try {
    const privileged = req.user?.role === 'super_admin' || req.user?.is_superadmin === true;
    if (!privileged) {
      return res.status(403).json({
        success: false,
        message: 'Only super administrators can use login as technician.',
      });
    }

    const { technician_id, technician_email } = req.body;
    if (!technician_id || !technician_email) {
      return res.status(400).json({
        success: false,
        message: 'technician_id and technician_email are required',
      });
    }

    const result = await loginAsTechnician({
      technicianId: Number(technician_id),
      technicianEmail: technician_email,
      impersonatedByUserId: req.user?.user_id,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }

    const name = [result.technician.first_name, result.technician.last_name].filter(Boolean).join(' ');
    res.json({
      success: true,
      message: `Welcome ${name}! You are logged in as a technician.`,
      technicianToken: result.token,
      technician: result.technician,
    });
  } catch (e) {
    console.error('loginAsTechnician', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.deleteTechnician = async (req, res) => {
  try {
    const result = await technicianService.deleteTechnician(Number(req.params.id));
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: 'Technician removed' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.podUploadMiddleware = podUpload;
exports.technicianUploadMiddleware = technicianUpload;
