const {
  UniqueConstraintError,
  ForeignKeyConstraintError,
  ValidationError: SeqValidationError,
  DatabaseError,
} = require('sequelize');
const { AppError } = require('../utils/apiError');
const { buildMeta } = require('../utils/apiResponse');
const logger = require('../lib/logger');

/**
 * Global error handler.
 * Maps AppError hierarchy, Sequelize errors, and unexpected errors to consistent responses.
 * Never leaks stack traces or internal details to the client.
 */
const errorHandler = (err, req, res, next) => {
  const meta = buildMeta(req);

  // ─── Operational errors (AppError hierarchy) ──────
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error(err.message, { requestId: req.id, stack: err.stack });
    }
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
      meta,
    });
  }

  // ─── Sequelize known errors ──────────────────────
  if (err instanceof UniqueConstraintError) {
    const field = err.errors?.[0]?.path || 'field';
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: `A record with this ${field} already exists`,
        details: [],
      },
      meta,
    });
  }

  if (err instanceof ForeignKeyConstraintError) {
    const field = err.index || 'reference';
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_REFERENCE', message: `Invalid reference: ${field}`, details: [] },
      meta,
    });
  }

  if (err instanceof SeqValidationError) {
    logger.error('Sequelize validation error', { requestId: req.id, message: err.message });
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_DATA', message: 'Invalid data provided', details: [] },
      meta,
    });
  }

  if (err instanceof DatabaseError) {
    logger.error('Database error', { requestId: req.id, message: err.message });
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: [] },
      meta,
    });
  }

  // ─── Malformed JSON ───────────────────────────────
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'MALFORMED_JSON', message: 'Malformed JSON in request body', details: [] },
      meta,
    });
  }

  // ─── Unexpected errors ────────────────────────────
  logger.error('Unhandled error', {
    requestId: req.id,
    error: err.message,
    stack: err.stack,
  });

  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: [] },
    meta,
  });
};

module.exports = errorHandler;
