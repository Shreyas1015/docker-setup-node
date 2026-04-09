const logger = require('./logger');
const { SecurityEvent } = require('../models');

/**
 * Security event logger.
 * Writes to both Winston (immediate) and SecurityEvent table (audit trail).
 * Fire-and-forget DB writes — never throws, never blocks the request.
 */

const EVENT_TYPES = {
  AUTH_SUCCESS: 'AUTH_SUCCESS',
  AUTH_FAILURE: 'AUTH_FAILURE',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOKEN_FAMILY_REVOKED: 'TOKEN_FAMILY_REVOKED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
};

async function persist(type, data) {
  try {
    await SecurityEvent.create({
      type,
      userId: data.userId || null,
      ip: data.ip || null,
      userAgent: data.userAgent || null,
      metadata: data.metadata || null,
    });
  } catch (err) {
    logger.error('Failed to persist security event', { type, error: err.message });
  }
}

const logAuthSuccess = (userId, ip, userAgent) => {
  logger.info('Security: AUTH_SUCCESS', { userId, ip });
  persist(EVENT_TYPES.AUTH_SUCCESS, { userId, ip, userAgent });
};

const logAuthFailure = (email, ip, userAgent, reason) => {
  logger.warn('Security: AUTH_FAILURE', { email, ip, reason });
  persist(EVENT_TYPES.AUTH_FAILURE, { ip, userAgent, metadata: { email, reason } });
};

const logAccountLocked = (userId, ip) => {
  logger.warn('Security: ACCOUNT_LOCKED', { userId, ip });
  persist(EVENT_TYPES.ACCOUNT_LOCKED, { userId, ip });
};

const logTokenRevoked = (userId, reason) => {
  logger.info('Security: TOKEN_REVOKED', { userId, reason });
  persist(EVENT_TYPES.TOKEN_REVOKED, { userId, metadata: { reason } });
};

const logTokenFamilyRevoked = (userId, familyId) => {
  logger.warn('Security: TOKEN_FAMILY_REVOKED — possible compromise', { userId, familyId });
  persist(EVENT_TYPES.TOKEN_FAMILY_REVOKED, { userId, metadata: { familyId } });
};

const logPermissionDenied = (userId, ip, path, requiredRoles) => {
  logger.warn('Security: PERMISSION_DENIED', { userId, ip, path, requiredRoles });
  persist(EVENT_TYPES.PERMISSION_DENIED, { userId, ip, metadata: { path, requiredRoles } });
};

module.exports = {
  EVENT_TYPES,
  logAuthSuccess,
  logAuthFailure,
  logAccountLocked,
  logTokenRevoked,
  logTokenFamilyRevoked,
  logPermissionDenied,
};
