'use strict';
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = require('express').Router();
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const { multerLimits, wrapMulter } = require('../config/uploadLimits');
const ctrl = require('../controllers/supportV2Controller');
const tickets = require('../controllers/supportV2TicketController');
const wos = require('../controllers/supportV2WorkOrderController');
const returns = require('../controllers/supportV2ReturnController');
const repl = require('../controllers/supportV2ReplacementController');
const parts = require('../controllers/supportV2PartsController');
const dispatch = require('../controllers/supportV2DispatchController');
const attendance = require('../controllers/supportV2AttendanceController');
const reports = require('../controllers/supportV2ReportsController');
const settings = require('../controllers/supportV2SettingsController');
const charges = require('../controllers/supportV2ChargesController');
const { requireWoType, requireOwnWo, withIdempotency } = require('../middleware/supportWoAccess');

const viewTickets = checkSectionPermission('support_tickets', 'view');
const createTickets = checkSectionPermission('support_tickets', 'create');
const editTickets = checkSectionPermission('support_tickets', 'edit');
const deleteTickets = checkSectionPermission('support_tickets', 'delete');
const editTriage = checkSectionPermission('support_triage', 'edit');
const viewWos = checkSectionPermission('support_work_orders', 'view');
const createWos = checkSectionPermission('support_work_orders', 'create');
const editWos = checkSectionPermission('support_work_orders', 'edit');
const deleteWos = checkSectionPermission('support_work_orders', 'delete');
const viewDash = checkSectionPermission('support_dashboard', 'view');
const viewDispatch = checkSectionPermission('support_dispatch', 'view');
const editDispatch = checkSectionPermission('support_dispatch', 'edit');
const viewBucket = checkSectionPermission('support_bucket', 'view');
const editBucket = checkSectionPermission('support_bucket', 'edit');
const viewReturn = checkSectionPermission('support_pickup_return', 'view');
const createReturn = checkSectionPermission('support_pickup_return', 'create');
const editReturn = checkSectionPermission('support_pickup_return', 'edit');
const viewApprovals = checkSectionPermission('support_approvals', 'view');
const editApprovals = checkSectionPermission('support_approvals', 'edit');
const viewRepl = checkSectionPermission('support_replacement', 'view');
const createRepl = checkSectionPermission('support_replacement', 'create');
const editRepl = checkSectionPermission('support_replacement', 'edit');
const deleteRepl = checkSectionPermission('support_replacement', 'delete');
const viewPartReq = checkSectionPermission('support_parts_request', 'view');
const createPartReq = checkSectionPermission('support_parts_request', 'create');
const editPartReq = checkSectionPermission('support_parts_request', 'edit');
const viewPartAppr = checkSectionPermission('support_parts_approve', 'view');
const editPartAppr = checkSectionPermission('support_parts_approve', 'edit');
const viewReports = checkSectionPermission('support_reports', 'view');
const viewSettings = checkSectionPermission('support_settings', 'view');
const editSettings = checkSectionPermission('support_settings', 'edit');

const uploadDir = path.join('uploads', 'support-v2');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.bin';
      cb(null, `sv2-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: multerLimits({ files: 12, fileSize: 15 * 1024 * 1024 }),
});

router.use(authMiddleware);

router.get('/badges', checkAnySectionPermission(
  ['support_dashboard', 'support_tickets', 'support_bucket', 'support_dispatch'],
  'view'
), ctrl.getBadges);

router.get('/health', ctrl.health);

router.get('/views', viewTickets, ctrl.listViews);
router.post('/views', viewTickets, ctrl.createView);
router.delete('/views/:id', viewTickets, ctrl.deleteView);

router.get('/customers/search', viewTickets, tickets.searchCustomers);
router.get('/customers/:id/context', viewTickets, tickets.customerContext);
router.get('/customers/:id/assets', viewTickets, tickets.customerAssets);
router.get('/customers/:id/contacts', viewTickets, tickets.customerContacts);

router.get('/tickets/search', viewTickets, tickets.searchTickets);
router.get('/tickets/counts', viewTickets, ctrl.ticketCounts);
router.get('/queue-meta', viewTickets, ctrl.queueMeta);
router.post('/tickets/bulk-assign', editDispatch, ctrl.bulkAssign);
router.get('/dashboard', viewDash, ctrl.dashboard);

router.get('/me/bucket', viewBucket, dispatch.myBucket);
router.get('/me/bucket/summary', viewBucket, dispatch.myBucketSummary);
router.post('/me/bucket/sync', editBucket, dispatch.syncBucket);
router.get('/dispatch/board', viewDispatch, dispatch.board);
router.post('/dispatch/assign', editDispatch, dispatch.assign);
router.post('/dispatch/auto-assign', editDispatch, dispatch.autoAssign);
router.get('/dispatch/capacity', viewDispatch, dispatch.capacity);
router.get('/assignees/availability', viewTickets, dispatch.slotAvailability);
router.get('/assignees/:userId/availability', viewTickets, dispatch.assigneeAvailability);
router.get('/charges', checkSectionPermission('support_charges_billing', 'view'), charges.list);
router.post('/charges/:id/decide', checkSectionPermission('support_charges_billing', 'edit'), charges.decide);
router.post('/charges/bulk', checkSectionPermission('support_charges_billing', 'edit'), charges.bulk);
router.get('/attendance', viewDispatch, attendance.list);
router.put('/attendance', editDispatch, attendance.upsert);

router.post('/attachments/staging', createTickets, wrapMulter(upload.array('files', 12)), tickets.addAttachment);
router.get('/lines/:lineId/repeat-check', viewTickets, tickets.repeatCheck);
router.get('/lines/:lineId/replacement-context', viewRepl, repl.context);
router.post('/lines/:lineId/replacement', createRepl, repl.create);
router.get('/replacements/candidates', viewRepl, repl.candidates);
router.patch('/replacements/:id', editRepl, repl.patch);
router.post('/replacements/:id/waive-collect', editRepl, repl.waiveCollect);
router.post('/replacements/:id/cancel', deleteRepl, repl.cancel);
router.post('/lines/:lineId/found', editTickets, tickets.setFound);
router.post('/lines/:lineId/resolve', editTickets, tickets.resolveLine);

router.post('/tickets', createTickets, tickets.create);
router.get('/tickets', viewTickets, ctrl.listTickets);
router.get('/tickets/:id', viewTickets, ctrl.getTicket);
router.patch('/tickets/:id', editTickets, tickets.patchTicket);
router.post('/tickets/:id/classify', editTriage, tickets.classify);
router.post('/tickets/:id/priority-override', editTriage, tickets.priorityOverride);
router.post('/tickets/:id/assign', editTickets, tickets.assign);
router.post('/tickets/:id/status', editTickets, tickets.setStatus);
router.post('/tickets/:id/pause', editTickets, tickets.pause);
router.post('/tickets/:id/resume', editTickets, tickets.resume);
router.post('/tickets/:id/resolve', editTickets, tickets.resolveTicket);
router.post('/tickets/:id/close', editTickets, tickets.closeTicket);
router.post('/tickets/:id/reopen', editTickets, tickets.reopenTicket);
router.post('/tickets/:id/cancel', deleteTickets, tickets.cancelTicket);
router.post('/tickets/:id/link', editTickets, tickets.linkTicket);
router.post('/tickets/:id/comment', viewTickets, tickets.comment);
router.post('/tickets/:id/attachments', editTickets, wrapMulter(upload.array('files', 12)), tickets.addAttachment);
router.post('/returns/bulk', createReturn, returns.createBulk);
router.get('/returns/bulk/:groupId', viewReturn, returns.getBulk);
router.get('/returns/catalog', checkAnySectionPermission(
  ['support_work_orders', 'support_bucket', 'support_pickup_return'],
  'view'
), returns.catalog);
router.post('/returns/preview', viewReturn, returns.preview);
router.get('/approvals', viewApprovals, returns.listApprovals);
router.post('/approvals/:id/decide', editApprovals, returns.decideApproval);

router.get('/parts/compatible', viewPartReq, parts.compatible);
router.post('/parts/requests', createPartReq, parts.create);
router.get('/parts/requests', viewPartReq, parts.list);
router.get('/parts/queue', viewPartAppr, parts.queue);
router.post('/parts/requests/:id/approve', editPartAppr, parts.approve);
router.post('/parts/requests/:id/reject', editPartAppr, parts.reject);
router.post('/parts/requests/:id/escalate', editPartAppr, parts.escalate);
router.post('/parts/requests/:id/issue', editPartAppr, parts.issue);
router.post('/parts/requests/:id/consume', editBucket, parts.consume);
router.post('/parts/requests/:id/return-unused', editBucket, parts.returnUnused);
router.post('/parts/requests/:id/cancel', editPartReq, parts.cancel);

router.post('/tickets/:id/work-orders', createWos, requireWoType('can_create', { fromBody: true }), wos.create);

router.get('/work-orders', viewWos, ctrl.listWorkOrders);
router.post('/work-orders/:woId/condition', editBucket, requireOwnWo(), requireWoType('can_edit', { generalSection: 'support_bucket' }), returns.saveCondition);
router.post('/work-orders/:woId/warehouse-receipt', editReturn, requireWoType('can_edit', { generalSection: 'support_pickup_return' }), returns.warehouseReceipt);
router.get('/work-orders/:woId', viewWos, wos.getOne);
router.patch('/work-orders/:woId', editWos, requireWoType('can_edit'), wos.patch);
router.post('/work-orders/:woId/assign', editDispatch, wos.assign);
router.post('/work-orders/:woId/accept', editBucket, requireOwnWo(), requireWoType('can_edit', { generalSection: 'support_bucket' }), withIdempotency, wos.accept);
router.post('/work-orders/:woId/en-route', editBucket, requireOwnWo(), requireWoType('can_edit', { generalSection: 'support_bucket' }), withIdempotency, wos.enRoute);
router.post('/work-orders/:woId/on-site', editBucket, requireOwnWo(), requireWoType('can_edit', { generalSection: 'support_bucket' }), withIdempotency, wos.onSite);
router.post('/work-orders/:woId/start', editBucket, requireOwnWo(), requireWoType('can_edit', { generalSection: 'support_bucket' }), withIdempotency, wos.start);
router.post('/work-orders/:woId/steps/:code', editBucket, requireOwnWo(), requireWoType('can_edit', { generalSection: 'support_bucket' }), withIdempotency, wos.completeStep);
router.post('/work-orders/:woId/verify-otp', editBucket, requireOwnWo(), requireWoType('can_edit', { generalSection: 'support_bucket' }), withIdempotency, wos.verifyOtp);
router.post('/work-orders/:woId/complete', editBucket, requireOwnWo(), requireWoType('can_edit', { generalSection: 'support_bucket' }), withIdempotency, wos.complete);
router.post('/work-orders/:woId/fail', editBucket, requireOwnWo(), requireWoType('can_edit', { generalSection: 'support_bucket' }), withIdempotency, wos.fail);
router.post('/work-orders/:woId/cancel', deleteWos, requireWoType('can_delete'), wos.cancel);
router.get('/work-orders/:woId/document', viewWos, wos.document);

router.get('/events/:ticketId', viewTickets, ctrl.listEvents);

router.get('/reports/:name/export', viewReports, reports.exportReport);
router.get('/reports/:name', viewReports, reports.getReport);
router.get('/settings', viewSettings, settings.getSettings);
router.patch('/settings', editSettings, settings.patchSettings);
router.patch('/settings/templates/:id', editSettings, settings.patchTemplate);

module.exports = router;
