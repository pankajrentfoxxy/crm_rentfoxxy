const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/deliveryRegisterController');

const router = express.Router();
const roles = ['admin', 'manager', 'sales', 'super_admin'];

router.use(authMiddleware);
router.use(checkRole(...roles));

router.get('/counts', ctrl.getCounts);
router.get('/technicians/meta/add', ctrl.getTechnicianAddMeta);
router.get('/technicians', ctrl.listTechnicians);
router.post('/technicians', ctrl.createTechnician);
router.post('/technicians/login-as', ctrl.loginAsTechnician);
router.post('/technicians/status', ctrl.updateTechnicianStatus);
router.get('/technicians/:id', ctrl.getTechnician);
router.patch('/technicians/:id', ctrl.updateTechnician);
router.delete('/technicians/:id', ctrl.deleteTechnician);
router.get('/:status', ctrl.listByStatus);
router.post('/change-delivery-person', ctrl.changeDeliveryPerson);
router.post('/:dcNumber/send-otp', ctrl.sendOtp);
router.post('/:dcNumber/verify-otp', ctrl.verifyOtp);
router.post('/:dcNumber/pod', ctrl.submitPod);

module.exports = router;
