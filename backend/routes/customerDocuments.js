const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/customerDocumentController');

const router = express.Router();
const cp = checkSectionPermission;

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

router.get('/:customerId', cp('customer_documents', 'view'), ctrl.listDocuments);
router.post('/:customerId/upload', cp('customer_documents', 'create'), upload.single('file'), ctrl.uploadDocument);
router.delete('/:customerId/:docId', cp('customer_documents', 'delete'), ctrl.deleteDocument);

module.exports = router;
