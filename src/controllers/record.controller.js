const recordService = require('../services/record.service');
const { success, created, paginated } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const result = await recordService.list(req.validatedQuery);
  return paginated(req, res, result.records, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
  const record = await recordService.getById(req.validatedParams.id);
  return success(req, res, record);
});

const create = asyncHandler(async (req, res) => {
  const record = await recordService.create(req.body, req.user.userId);
  return created(req, res, record, 'Record created successfully');
});

const update = asyncHandler(async (req, res) => {
  const record = await recordService.update(
    req.validatedParams.id,
    req.body,
    req.user.userId,
    req.user.role
  );
  return success(req, res, record, 'Record updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await recordService.remove(req.validatedParams.id, req.user.userId, req.user.role);
  return success(req, res, null, 'Record deleted successfully');
});

module.exports = { list, getById, create, update, remove };
