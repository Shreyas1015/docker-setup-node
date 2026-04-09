const userService = require('../services/user.service');
const { success, created, paginated } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const { page, limit } = req.validatedQuery;
  const result = await userService.list(page, limit);
  return paginated(req, res, result.users, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
  const user = await userService.getById(req.validatedParams.id);
  return success(req, res, user);
});

const create = asyncHandler(async (req, res) => {
  const user = await userService.create(req.body);
  return created(req, res, user, 'User created successfully');
});

const update = asyncHandler(async (req, res) => {
  const user = await userService.update(req.validatedParams.id, req.body);
  return success(req, res, user, 'User updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await userService.remove(req.validatedParams.id);
  return success(req, res, null, 'User deleted successfully');
});

module.exports = { list, getById, create, update, remove };
