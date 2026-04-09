const { buildMeta } = require('../utils/apiResponse');

const formatZodErrors = (zodError) => {
  return (zodError.issues || []).map((e) => ({
    field: e.path.join('.'),
    message: e.message,
  }));
};

const validate = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: formatZodErrors(result.error),
        },
        meta: buildMeta(req),
      });
    }
    req.body = result.data;
    next();
  };
};

const validateQuery = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: formatZodErrors(result.error),
        },
        meta: buildMeta(req),
      });
    }
    req.validatedQuery = result.data;
    next();
  };
};

const validateParams = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid URL parameters',
          details: formatZodErrors(result.error),
        },
        meta: buildMeta(req),
      });
    }
    req.validatedParams = result.data;
    next();
  };
};

module.exports = { validate, validateQuery, validateParams };
