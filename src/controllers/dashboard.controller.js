const dashboardService = require('../services/dashboard.service');
const { success } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const summary = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.validatedQuery;
  const data = await dashboardService.summary(startDate, endDate);
  return success(req, res, data);
});

const categoryBreakdown = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.validatedQuery;
  const data = await dashboardService.categoryBreakdown(startDate, endDate);
  return success(req, res, data);
});

const trends = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.validatedQuery;
  const data = await dashboardService.trends(startDate, endDate);
  return success(req, res, data);
});

const recent = asyncHandler(async (req, res) => {
  const { limit } = req.validatedQuery;
  const data = await dashboardService.recent(limit);
  return success(req, res, data);
});

module.exports = { summary, categoryBreakdown, trends, recent };
