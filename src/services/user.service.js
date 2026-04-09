const bcrypt = require('bcrypt');
const { User } = require('../models');
const logger = require('../lib/logger');
const config = require('../config');
const { NotFoundError, ConflictError } = require('../utils/apiError');

const list = async (page, limit) => {
  const offset = (page - 1) * limit;

  const { rows: users, count: total } = await User.findAndCountAll({
    offset,
    limit,
    order: [['created_at', 'DESC']],
  });

  return {
    users,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

const getById = async (id) => {
  const user = await User.findOne({ where: { id } });
  if (!user) throw new NotFoundError('User not found');
  return user;
};

const create = async ({ email, password, name, role }) => {
  const existing = await User.findOne({ where: { email } });
  if (existing) throw new ConflictError('Email already registered');

  const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
  const user = await User.create({ email, passwordHash, name, role: role || 'VIEWER' });

  logger.info('User created by admin', { userId: user.id, email, role: user.role });
  return user;
};

const update = async (id, data) => {
  const existing = await User.findOne({ where: { id } });
  if (!existing) throw new NotFoundError('User not found');

  await existing.update(data);
  logger.info('User updated', { userId: id, changes: Object.keys(data) });
  return existing;
};

const remove = async (id) => {
  const existing = await User.findOne({ where: { id } });
  if (!existing) throw new NotFoundError('User not found');

  await existing.destroy();
  logger.info('User soft-deleted', { userId: id });
};

module.exports = { list, getById, create, update, remove };
