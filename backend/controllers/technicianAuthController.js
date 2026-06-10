const {
  loginTechnician,
  getTechnicianProfile,
  getTechnicianDashboard,
} = require('../services/technicianAuthService');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    const result = await loginTechnician(email, password);
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      message: 'Login successful',
      token: result.token,
      technician: result.technician,
    });
  } catch (e) {
    console.error('technician login', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.me = async (req, res) => {
  try {
    const technician = await getTechnicianProfile(req.technician.technician_id);
    if (!technician) {
      return res.status(404).json({ success: false, message: 'Technician not found' });
    }
    if (!technician.is_active) {
      return res.status(403).json({ success: false, message: 'Account is inactive' });
    }
    res.json({
      success: true,
      technician: {
        ...technician,
        technician_impersonation: !!req.technician.technician_impersonation,
        impersonated_by_user_id: req.technician.impersonated_by_user_id || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.dashboard = async (req, res) => {
  try {
    const technician = await getTechnicianProfile(req.technician.technician_id);
    if (!technician) {
      return res.status(404).json({ success: false, message: 'Technician not found' });
    }
    const stats = await getTechnicianDashboard(
      technician.technician_id,
      technician.user_id || req.technician.user_id
    );
    res.json({ success: true, technician, ...stats });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
