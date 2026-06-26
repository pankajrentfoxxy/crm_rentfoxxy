const express = require('express');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/deliveryRegisterController');

const router = express.Router();
const cp = checkSectionPermission;
const SEC = 'delivery_register_management';
const view = cp(SEC, 'view');
const create = cp(SEC, 'create');
const edit = cp(SEC, 'edit');
const del = cp(SEC, 'delete');

router.use(authMiddleware);

router.get('/counts', view, ctrl.getCounts);
router.get('/technicians/meta/add', view, ctrl.getTechnicianAddMeta);
router.get('/technicians', view, ctrl.listTechnicians);
router.post('/technicians', create, ctrl.createTechnician);
router.post('/technicians/login-as', edit, ctrl.loginAsTechnician);
router.post('/technicians/status', edit, ctrl.updateTechnicianStatus);
router.get('/technicians/:id', view, ctrl.getTechnician);
router.patch('/technicians/:id', edit, ctrl.updateTechnician);
router.post('/technicians/:id/password', edit, ctrl.changeTechnicianPassword);
router.delete('/technicians/:id', del, ctrl.deleteTechnician);
router.get('/:status', view, ctrl.listByStatus);
router.post('/change-delivery-person', edit, ctrl.changeDeliveryPerson);
router.post('/:dcNumber/send-otp', edit, ctrl.sendOtp);
router.post('/:dcNumber/verify-otp', edit, ctrl.verifyOtp);
router.post('/:dcNumber/pod', edit, ctrl.submitPod);

module.exports = router;
