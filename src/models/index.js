const sequelize = require('../lib/sequelize');

const User = require('./User')(sequelize);
const FinancialRecord = require('./FinancialRecord')(sequelize);
const RefreshToken = require('./RefreshToken')(sequelize);
const SecurityEvent = require('./SecurityEvent')(sequelize);

// Set up associations
const models = { User, FinancialRecord, RefreshToken, SecurityEvent };

Object.values(models).forEach((model) => {
  if (model.associate) {
    model.associate(models);
  }
});

module.exports = { sequelize, ...models };
