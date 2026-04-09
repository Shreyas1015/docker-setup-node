const app = require('./app');
const config = require('./config');
const logger = require('./lib/logger');
const { sequelize } = require('./models');

const start = async () => {
  await sequelize.authenticate();
  logger.info('Database connection established');

  const server = app.listen(config.port, () => {
    logger.info(`Server running on port ${config.port}`, {
      env: config.nodeEnv,
      port: config.port,
    });
  });

  // ─── GRACEFUL SHUTDOWN ──────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);

    server.close(async () => {
      await sequelize.close();
      logger.info('Database connection closed');
      process.exit(0);
    });

    // Force exit after 10s if graceful shutdown fails
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

// Catch unhandled errors
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { error: reason?.message || reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

start();
