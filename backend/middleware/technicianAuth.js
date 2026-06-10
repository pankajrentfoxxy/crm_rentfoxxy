const jwt = require('jsonwebtoken');

const technicianAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No technician token, access denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.auth_type !== 'technician') {
      return res.status(401).json({ success: false, message: 'Invalid technician token' });
    }

    req.technician = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Technician token is not valid' });
  }
};

module.exports = { technicianAuth };
