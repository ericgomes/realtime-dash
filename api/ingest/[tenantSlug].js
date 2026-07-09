const { handleIngest } = require('../../lib/ingest-core');

module.exports = async (req, res) => {
  const q = req.query || {};
  const slug = q.tenantSlug || 'prospin';
  return handleIngest(req, res, slug);
};
