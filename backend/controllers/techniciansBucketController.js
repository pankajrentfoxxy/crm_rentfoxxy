const {
  listBucketTechnicians,
  fetchBucketDetails,
} = require('../services/techniciansBucketService');

exports.getMeta = async (_req, res) => {
  try {
    const technicians = await listBucketTechnicians();
    res.json({ success: true, technicians });
  } catch (e) {
    console.error('techniciansBucket getMeta', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.fetchDetails = async (req, res) => {
  try {
    const technicianId = req.query.technician_id || req.query.technicianId || 'all';
    const type = req.query.type || 'assets';
    const search = (req.query.search || '').trim();

    if (!technicianId) {
      return res.json({ success: true, type, items: [], total: 0 });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const result = await fetchBucketDetails({ technicianId, type, search, page, limit });
    res.json({
      success: true,
      type,
      items: result.items,
      total: result.total,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (e) {
    console.error('techniciansBucket fetchDetails', e);
    res.status(500).json({ success: false, message: e.message });
  }
};
