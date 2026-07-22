const express = require('express');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/deliveryRegisterController');

const router = express.Router();
const cp = checkSectionPermission;
const SEC = 'delivery_register_management';
const TECH = 'technician_bucket';
const view = cp(SEC, 'view');
const create = cp(SEC, 'create');
const edit = cp(SEC, 'edit');
const del = cp(SEC, 'delete');
const techView = cp(TECH, 'view');
const techCreate = cp(TECH, 'create');
const techEdit = cp(TECH, 'edit');
const techDel = cp(TECH, 'delete');

router.use(authMiddleware);

router.get('/counts', view, ctrl.getCounts);
router.get('/technicians/meta/add', techView, ctrl.getTechnicianAddMeta);
router.get('/technicians', techView, ctrl.listTechnicians);
router.post('/technicians', techCreate, ctrl.createTechnician);
router.post('/technicians/login-as', techEdit, ctrl.loginAsTechnician);
router.post('/technicians/status', techEdit, ctrl.updateTechnicianStatus);
router.get('/technicians/:id', techView, ctrl.getTechnician);
router.patch('/technicians/:id', techEdit, ctrl.updateTechnician);
router.post('/technicians/:id/password', techEdit, ctrl.changeTechnicianPassword);
router.delete('/technicians/:id', techDel, ctrl.deleteTechnician);
router.get('/:status', view, ctrl.listByStatus);
router.post('/change-delivery-person', edit, ctrl.changeDeliveryPerson);
router.post('/:dcNumber/send-otp', edit, ctrl.sendOtp);
router.post('/:dcNumber/verify-otp', edit, ctrl.verifyOtp);
router.post('/:dcNumber/pod', edit, ctrl.submitPod);

module.exports = router;
