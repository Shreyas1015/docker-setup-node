const winston = require('winston');
const config = require('../config');

// ─── SENSITIVE FIELD REDACTION ──────────────────────
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'api_key',
]);

const redact = winston.format((info) => {
  if (typeof info === 'object') {
    redactObject(info);
  }
  return info;
});

function redactObject(obj) {
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      obj[key] = '[REDACTED]';
    } else if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      redactObject(obj[key]);
    }
  }
}

// ─── DEV FORMAT (readable, multi-line) ──────────────
const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const { service: _service, requestId, ...rest } = meta;
    const reqTag = requestId ? ` [${requestId.slice(0, 8)}]` : '';
    let line = `${timestamp} ${level}${reqTag} ${message}`;

    if (Object.keys(rest).length > 0) {
      line +=
        '\n' +
        JSON.stringify(rest, null, 2)
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n');
    }
    return line;
  })
);

// ─── PROD FORMAT (single-line JSON for log aggregators) ─
const prodFormat = winston.format.json();

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    redact()
  ),
  defaultMeta: { service: 'zorvyn-api' },
  transports: [
    new winston.transports.Console({
      format: config.isProduction ? prodFormat : devFormat,
    }),
  ],
});

module.exports = logger;
