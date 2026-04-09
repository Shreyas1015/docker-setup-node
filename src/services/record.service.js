const { Op } = require('sequelize');
const { FinancialRecord, User } = require('../models');
const logger = require('../lib/logger');
const { NotFoundError, ForbiddenError } = require('../utils/apiError');

const list = async ({ page, limit, type, category, startDate, endDate, sortBy, order }) => {
  const offset = (page - 1) * limit;
  const where = {};
  if (type) where.type = type;
  if (category) where.category = category;
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date[Op.gte] = new Date(startDate);
    if (endDate) where.date[Op.lte] = new Date(endDate);
  }

  const { rows: records, count: total } = await FinancialRecord.findAndCountAll({
    where,
    offset,
    limit,
    order: [[sortBy, order.toUpperCase()]],
  });

  return {
    records,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

const getById = async (id) => {
  const record = await FinancialRecord.findOne({
    where: { id },
    include: [{ model: User, as: 'creator', attributes: ['id', 'name'] }],
  });
  if (!record) throw new NotFoundError('Record not found');
  return record;
};

const create = async (data, userId) => {
  const record = await FinancialRecord.create({
    amount: data.amount,
    type: data.type,
    category: data.category,
    date: new Date(data.date),
    description: data.description || null,
    createdBy: userId,
  });
  logger.info('Record created', { recordId: record.id, type: record.type, userId });
  return record;
};

const update = async (id, data, userId, userRole) => {
  const existing = await FinancialRecord.findOne({ where: { id } });
  if (!existing) throw new NotFoundError('Record not found');

  // Ownership check — only the creator or an admin can modify
  if (userRole !== 'ADMIN' && existing.createdBy !== userId) {
    throw new ForbiddenError('You can only modify your own records');
  }

  const updateData = { ...data };
  if (data.date) updateData.date = new Date(data.date);

  await existing.update(updateData);
  logger.info('Record updated', { recordId: id, changes: Object.keys(data) });
  return existing;
};

const remove = async (id, userId, userRole) => {
  const existing = await FinancialRecord.findOne({ where: { id } });
  if (!existing) throw new NotFoundError('Record not found');

  if (userRole !== 'ADMIN' && existing.createdBy !== userId) {
    throw new ForbiddenError('You can only delete your own records');
  }

  await existing.destroy();
  logger.info('Record soft-deleted', { recordId: id });
};

module.exports = { list, getById, create, update, remove };
