const express = require('express');
const router = express.Router();
const multer = require('multer');
const { multerLimits } = require('../config/uploadLimits');
const path = require('path');
const fs = require('fs');
const { authMiddleware, checkAnySectionPermission } = require('../middleware/auth');

// Part 5.6 (finding R13) — every route in this file carried authMiddleware and
// nothing else, so any logged-in user could submit a diagnosis, attach a part,
// or assign parts as procurement.
const DIAGNOSIS_SECTIONS = ['floor_tickets', 'floor_pipeline', 'tickets', 'diagnosis_failed'];
const dxView = checkAnySectionPermission(DIAGNOSIS_SECTIONS, 'view');
const dxEdit = checkAnySectionPermission(DIAGNOSIS_SECTIONS, 'edit');
const {
    getDiagnosisSections,
    getDiagnosis,
    saveDiagnosis,
    submitDiagnosis,
    getPartsRequired,
    attachPart,
    uploadDiagnosisImage,
    assignPartByProcurement
} = require('../controllers/diagnosisController');

// Configure Multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/diagnosis';
        // Create directory if not exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Unique filename: ticketId-timestamp-originalName
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'diagnosis-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: multerLimits(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// All routes require authentication
router.use(authMiddleware);

// Get diagnosis sections configuration
router.get('/sections', dxView, getDiagnosisSections);

// Get diagnosis for a ticket
router.get('/ticket/:id', dxView, getDiagnosis);

// Save diagnosis draft
router.post('/ticket/:id', dxEdit, saveDiagnosis);

// Submit completed diagnosis
router.post('/ticket/:id/submit', dxEdit, submitDiagnosis);

// Upload diagnosis image
router.post('/ticket/:id/images', dxEdit, upload.single('image'), uploadDiagnosisImage);

// Get parts required for a ticket
router.get('/ticket/:id/parts', dxView, getPartsRequired);

// Attach part to ticket
// Attach part to ticket (Assembly)
router.post('/ticket/:id/parts/attach', dxEdit, attachPart);

// Assign part (Procurement)
router.post('/ticket/:id/parts/assign-procurement', dxEdit, assignPartByProcurement);

module.exports = router;
