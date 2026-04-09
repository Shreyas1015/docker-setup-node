const { ForbiddenError } = require('../utils/apiError');
const securityLogger = require('../lib/securityLogger');

/**
 * Role-based access control middleware factory.
 * Checks req.user.role against allowed roles, logs denials as security events.
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      securityLogger.logPermissionDenied(req.user?.userId, req.ip, req.originalUrl, allowedRoles);
      return next(new ForbiddenError());
    }
    next();
  };
};

module.exports = { authorize };
