const pool = require('../config/db');

/**
 * The old diagnosis form (components/DiagnosisForm.jsx) looks parts up under
 * group words like 'Memory', 'Storage', 'Display', 'Power', 'Input'. Parts
 * used to be grouped by part_type, which holds the kind (ram, ssd, d_panel…)
 * since the part naming redesign — so group by category and name the group
 * the way that form expects.
 */
const GROUP_OF_CATEGORY = {
  ram: 'Memory',
  storage: 'Storage',
  display: 'Display',
  battery: 'Power',
  power: 'Power',
  keyboard: 'Input',
  motherboard: 'Core',
  cooling: 'Cooling',
  body: 'Chassis',
  general: 'Accessories',
  accessory: 'Accessories',
  consumable: 'Consumables',
  tools: 'Tools',
};

// Get All Parts Grouped by Category (for Dropdown)
exports.getPartsGrouped = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT part_id, part_name, part_type, category, quantity, location_code
        FROM parts
       WHERE archived IS NOT TRUE
       ORDER BY category, part_name
    `);

    const grouped = {};
    result.rows.forEach((part) => {
      const key = GROUP_OF_CATEGORY[String(part.category || '').toLowerCase()] || 'Accessories';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(part);
    });

    res.json({ success: true, parts: grouped });
  } catch (error) {
    console.error('Get grouped parts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.GROUP_OF_CATEGORY = GROUP_OF_CATEGORY;
