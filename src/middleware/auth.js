const jwt = require('jsonwebtoken');
const config = require('../config');
const { UnauthorizedError } = require('../utils/apiError');
const logger = require('../lib/logger');

/**
 * JWT authentication middleware.
 * Verifies Bearer token, checks it's an access token (not refresh), attaches payload to req.user.
 */
const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('No token provided'));
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    // Reject refresh tokens used as access tokens
    if (decoded.type !== 'access') {
      return next(new UnauthorizedError('Invalid token type'));
    }

    req.user = decoded;
    next();
  } catch (err) {
    logger.warn('JWT verification failed', {
      requestId: req.id,
      reason: err.name === 'TokenExpiredError' ? 'expired' : 'invalid',
    });
    return next(new UnauthorizedError('Invalid or expired token'));
  }
};

module.exports = { auth };
