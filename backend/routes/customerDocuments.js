const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authMiddleware, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/customerDocumentController');

const router = express.Router();
const roles = ['admin', 'manager', 'sales', 'accounts'];
const deleteRoles = ['admin', 'manager'];

const uploadDir = path.join('uploads', 'customer-documents', 'tmp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF, JPG, and PNG files are allowed'));
  },
});

router.use(authMiddleware);

router.get('/:customerId', checkRole(...roles), ctrl.listDocuments);
router.post('/:customerId/upload', checkRole(...roles), upload.single('file'), ctrl.uploadDocument);
router.delete('/:customerId/:docId', checkRole(...deleteRoles), ctrl.deleteDocument);

module.exports = router;
