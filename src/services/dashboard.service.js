const { Op, fn, col, QueryTypes } = require('sequelize');
const { FinancialRecord, sequelize } = require('../models');

const buildDateFilter = (startDate, endDate) => {
  const where = {};
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date[Op.gte] = new Date(startDate);
    if (endDate) where.date[Op.lte] = new Date(endDate);
  }
  return where;
};

const summary = async (startDate, endDate) => {
  const where = buildDateFilter(startDate, endDate);

  const [income, expense] = await Promise.all([
    FinancialRecord.findOne({
      where: { ...where, type: 'INCOME' },
      attributes: [
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'totalAmount'],
        [fn('COUNT', col('id')), 'count'],
      ],
      raw: true,
    }),
    FinancialRecord.findOne({
      where: { ...where, type: 'EXPENSE' },
      attributes: [
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'totalAmount'],
        [fn('COUNT', col('id')), 'count'],
      ],
      raw: true,
    }),
  ]);

  const totalIncome = Number(income.totalAmount) || 0;
  const totalExpenses = Number(expense.totalAmount) || 0;

  return {
    totalIncome,
    totalExpenses,
    netBalance: totalIncome - totalExpenses,
    recordCount: Number(income.count) + Number(expense.count),
  };
};

const categoryBreakdown = async (startDate, endDate) => {
  const where = buildDateFilter(startDate, endDate);

  const breakdown = await FinancialRecord.findAll({
    where,
    attributes: [
      'category',
      'type',
      [fn('SUM', col('amount')), 'total'],
      [fn('COUNT', col('id')), 'count'],
    ],
    group: ['category', 'type'],
    order: [[fn('SUM', col('amount')), 'DESC']],
    raw: true,
  });

  return breakdown.map((item) => ({
    category: item.category,
    type: item.type,
    total: Number(item.total),
    count: Number(item.count),
  }));
};

/**
 * Monthly trends — uses raw SQL for efficient GROUP BY at the database level.
 * Avoids fetching all records into JS memory.
 * Uses sequelize.query with named replacements (NOT string interpolation)
 * to prevent SQL injection via parameterized queries.
 */
const trends = async (startDate, endDate) => {
  const start = startDate ? new Date(startDate) : new Date('1970-01-01');
  const end = endDate ? new Date(endDate) : new Date('2099-12-31');

  const result = await sequelize.query(
    `SELECT
      TO_CHAR(date, 'YYYY-MM') AS month,
      SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END)::int AS income,
      SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END)::int AS expense
    FROM financial_record
    WHERE deleted_at IS NULL
      AND date >= :start::date
      AND date <= :end::date
    GROUP BY TO_CHAR(date, 'YYYY-MM')
    ORDER BY month ASC`,
    {
      replacements: { start, end },
      type: QueryTypes.SELECT,
    }
  );

  return result.map((row) => ({
    month: row.month,
    income: Number(row.income),
    expense: Number(row.expense),
  }));
};

const recent = async (limit) => {
  return FinancialRecord.findAll({
    order: [['date', 'DESC']],
    limit,
  });
};

module.exports = { summary, categoryBreakdown, trends, recent };
