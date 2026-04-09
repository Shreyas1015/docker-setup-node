/**
 * Standardized API response helpers.
 * Every response includes a meta block with requestId and timestamp for traceability.
 */

const buildMeta = (req) => ({
  requestId: req.id,
  timestamp: new Date().toISOString(),
});

const success = (req, res, data, message = 'Success', status = 200) => {
  return res.status(status).json({
    success: true,
    data,
    message,
    meta: buildMeta(req),
  });
};

const created = (req, res, data, message = 'Created successfully') => {
  return success(req, res, data, message, 201);
};

const paginated = (req, res, data, pagination, message = 'Success') => {
  return res.status(200).json({
    success: true,
    data,
    pagination,
    message,
    meta: buildMeta(req),
  });
};

module.exports = { success, created, paginated, buildMeta };
