const { Sequelize } = require('sequelize');
const config = require('../config');
const logger = require('./logger');

// Strip sslmode from URL to avoid pg v8 deprecation warning — handle SSL via dialectOptions
const rawUrl = process.env.DATABASE_URL;
const url = new URL(rawUrl);
const useSSL = url.searchParams.has('sslmode');
url.searchParams.delete('sslmode');
const dbUrl = url.toString();

const sequelize = new Sequelize(dbUrl, {
  dialect: 'postgres',
  logging: config.isProduction ? false : (msg) => logger.debug(msg),
  define: {
    underscored: true,
    timestamps: true,
  },
  dialectOptions: useSSL ? { ssl: { require: true, rejectUnauthorized: false } } : {},
  pool: {
    max: 10,
    min: 2,
    acquire: 30000,
    idle: 10000,
  },
});

module.exports = sequelize;
