const { v4: uuidv4, validate: isUuid } = require('uuid');

/**
 * Attaches a unique request ID to every request for tracing through logs.
 * Accepts client-provided X-Request-Id only if it's a valid UUID (prevents log injection).
 * Sets X-Request-Id header on the response for client-side correlation.
 */
const requestId = (req, res, next) => {
  const clientId = req.headers['x-request-id'];
  req.id = clientId && isUuid(clientId) ? clientId : uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
};

module.exports = requestId;
