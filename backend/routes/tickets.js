const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { multerLimits, wrapMulter } = require('../config/uploadLimits');

const qcPhotoDir = path.join('uploads', 'qc-photos');
if (!fs.existsSync(qcPhotoDir)) fs.mkdirSync(qcPhotoDir, { recursive: true });

const qcPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: qcPhotoDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.jpg';
      cb(null, `qc-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: multerLimits(),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Only image files are allowed'));
  },
});
const router = express.Router();
const {
  createTicket,
  getTickets,
  getMyTickets,
  getTicketById,
  getProductionHistory,
  updateTicket,
  moveToNextStage,
  assignTicket,
  addNote,
  addServiceCost,
  claimTicket,
  getAllStages,
  updateGrade,
  startWork,
  endWork,
  getActiveWorkLog,
  saveStageTask,
  getStageTask,
  bulkMoveTickets,
  getFloorManagerQueue,
  getTeamMembers,
  getNextAssignee,
  removePartFromTicket,
  logNote,
  getFloorNavCounts,
  getFloorStatusCounts,
} = require('../controllers/ticketController');
const qcController = require('../controllers/qcController');
const phase2 = require('../controllers/ticketPhase2Controller');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const ftView = checkSectionPermission('floor_tickets', 'view');
const ftEdit = checkSectionPermission('floor_tickets', 'edit');
const ftConfigEdit = checkSectionPermission('floor_ticket_config_edit', 'edit');
const ftAssign = checkAnySectionPermission(
  ['floor_tickets', 'floor_pipeline', 'tickets', 'replacement_so_laptop_qc'],
  'edit'
);
const floorPipelineView = checkSectionPermission('floor_pipeline', 'view');
const floorQueueView = checkAnySectionPermission(['floor_pipeline', 'floor_tickets'], 'view');
// Floor / Dispatch QC users need laptop history on ticket screens even without
// the dedicated ttspl_history menu permission.
const ttsplHistoryView = checkAnySectionPermission(
  ['ttspl_history', 'dispatch_qc', 'floor_pipeline', 'floor_tickets', 'qc_management'],
  'view'
);

// Part 5.6 (finding R13). Until now most of this router carried authMiddleware
// and nothing else, so ANY logged-in user could advance any ticket, submit QC,
// or fail a diagnosis. Every route below declares (section, action).
//
// The lists are wide on purpose. A ticket screen is reached from the floor
// pipeline, from QC management, from the SO QC screens and from Dispatch QC,
// and a role that can legitimately open one of those must not lose a screen it
// has today. What changes is that holding NO relevant permission is now a 403
// instead of a pass — the audit's actual finding.
const FLOOR_SECTIONS = [
  'floor_tickets', 'floor_pipeline', 'tickets', 'qc_management',
  'so_laptop_qc', 'replacement_so_laptop_qc', 'dispatch_qc', 'pending_inventory',
];
const floorAnyView = checkAnySectionPermission(FLOOR_SECTIONS, 'view');
const floorAnyEdit = checkAnySectionPermission(FLOOR_SECTIONS, 'edit');
const floorAnyCreate = checkAnySectionPermission(FLOOR_SECTIONS, 'create');
// QC submission is a write on a QC stage specifically.
const qcSubmit = checkAnySectionPermission(
  ['qc_management', 'floor_tickets', 'floor_pipeline', 'so_laptop_qc',
   'replacement_so_laptop_qc', 'dispatch_qc'],
  'edit'
);

// All routes require authentication
router.use(authMiddleware);

// @route   GET /api/tickets/stages
// @desc    Get all workflow stages
// @access  Private
router.get('/stages', floorAnyView, getAllStages);

// @route   POST /api/tickets
// @desc    Create a new ticket
// @access  Private
router.post('/', floorAnyCreate, createTicket);

// @route   GET /api/tickets
// @desc    Get all tickets (with filters)
// @access  Private
router.get('/', floorAnyView, getTickets);

// @route   GET /api/tickets/my
// @desc    Get tickets assigned to me or my team
// @access  Private
router.get('/my', floorAnyView, getMyTickets);

// @route   POST /api/tickets/bulk-move
// @desc    Bulk move all tickets from one stage to another
// @access  Private (Admin, Manager, Floor Manager)

// PD4 / F10: moving many tickets at once and failing a laptop back to its
// vendor are floor-manager decisions. One floor grant (floor_tickets edit),
// which technicians hold, used to open both.
const requireFloorLead = (req, res, next) => (require('../services/qcGateService').isManager(req.user)
  ? next()
  : res.status(403).json({ success: false, message: 'Only a floor manager or manager can do this.' }));
router.post('/bulk-move', ftEdit, requireFloorLead, bulkMoveTickets);

// QC assignee list (must be before /:id)
router.get('/qc/qc2-assignees', floorAnyView, qcController.getQC2Assignees);

// Phase 2 — floor pipeline (must be before /:id)
router.get('/floor-counts', floorAnyView, getFloorNavCounts);
router.get('/floor-status-counts', floorQueueView, getFloorStatusCounts);
router.get('/floor-dashboard', floorPipelineView, phase2.getFloorDashboard);
router.get(
  '/floor-manager-queue',
  floorQueueView,
  getFloorManagerQueue
);
router.get('/team-members', floorAnyView, getTeamMembers);
router.get('/:id/next-assignee', floorAnyView, getNextAssignee);
router.get('/:id/production-history', ftView, getProductionHistory);
router.get('/ttspl/:ttsplId/history', ttsplHistoryView, phase2.getTtsplHistory);
router.get('/ttspl/:ttsplId', ttsplHistoryView, phase2.getTicketsByTtsplId);
router.post('/:id/move-stage', floorAnyEdit, phase2.moveToStage);
router.patch('/:id/chip-repair', floorAnyEdit, phase2.markChipRepairRequired);
router.patch('/:id/body-paint', floorAnyEdit, phase2.markBodyPaintRequired);
router.patch(
  '/:id/floor-manager-fail',
  ftEdit,
  requireFloorLead,
  phase2.markQcFailed
);
router.patch('/:id/diagnosis-failed', floorAnyEdit, phase2.markDiagnosisFailed);
router.patch('/:id/config', ftConfigEdit, phase2.updateTtsplConfig);

// @route   GET /api/tickets/:id
// @desc    Get ticket by ID with full details
// @access  Private
router.get('/:id', floorAnyView, getTicketById);

// @route   PUT /api/tickets/:id
// @desc    Update ticket details
// @access  Private
router.put('/:id', floorAnyEdit, updateTicket);

// @route   POST /api/tickets/:id/next-stage
// @desc    Move ticket to next stage
// @access  Private
router.post('/:id/next-stage', floorAnyEdit, moveToNextStage);

// @route   POST /api/tickets/:id/assign
// @desc    Assign ticket to a user
// @access  Private (Team Lead, Manager, Floor Manager, Admin)
router.post('/:id/assign', ftAssign, assignTicket);

// @route   POST /api/tickets/:id/claim
// @desc    Claim an unassigned ticket for your team
// @access  Private (All Roles - validation in controller)
router.post('/:id/claim', floorAnyEdit, claimTicket);

// @route   PUT /api/tickets/:id/grade
// @desc    Update ticket grade
// @access  Private (Grading Team, Admin)
router.put('/:id/grade', floorAnyEdit, updateGrade);

// @route   POST /api/tickets/:id/notes
// @desc    Add note/comment to ticket
// @access  Private
router.post('/:id/notes', floorAnyEdit, addNote);

// @route   POST /api/tickets/:id/parts
// @desc    Add part to ticket
// @access  Private
// PD7 (Production safety B): parts are fitted only through a part request
// (request -> approve a real unit -> fit). These took stock off the count with
// no approval, no unit and no ledger entry, and chip-level "request part"
// created free-text requests nothing could fulfil.
const retiredPartIssue = (req, res) => res.status(410).json({
  success: false,
  code: 'PART_ISSUE_RETIRED',
  message: 'Parts are fitted only through a part request: request the part on the ticket, the warehouse approves a unit, then fit it.',
});
router.post('/:id/parts', floorAnyEdit, retiredPartIssue);
router.post(
  '/:id/parts-with-config',
  ftEdit,
  retiredPartIssue
);
router.delete('/:id/parts/:ticketPartId', ftEdit, removePartFromTicket);
router.post('/:id/log-note', floorAnyEdit, logNote);

// Cost & Parts System
router.post('/:id/part-request', floorAnyEdit, retiredPartIssue);
router.post('/:id/fulfill-part', floorAnyEdit, retiredPartIssue);
router.post('/:id/service-cost', floorAnyEdit, addServiceCost);
// Work Logs Routes
router.post('/:id/work/start', floorAnyEdit, startWork);
router.post('/:id/work/end', floorAnyEdit, endWork);
router.get('/:id/work/active', floorAnyView, getActiveWorkLog);

// Stage task checklist (Assembly & Software, Final Testing, ...)
router.get('/:id/stage-task', floorAnyView, getStageTask);
router.post('/:id/stage-task', floorAnyEdit, saveStageTask);

// QC Routes
router.get('/:id/qc', floorAnyView, qcController.getQCData);
router.post('/:id/qc/save', qcSubmit, qcController.saveQC);
router.post('/:id/qc/submit', qcSubmit, qcController.submitQC);
router.post('/qc/:qc_id/upload-photo', qcSubmit, wrapMulter(qcPhotoUpload.single('photo')), qcController.uploadPhoto);
router.get('/:ticket_id/qc/history', floorAnyView, qcController.getQCHistory);



module.exports = router;
