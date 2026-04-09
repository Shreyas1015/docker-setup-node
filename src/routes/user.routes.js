const router = require('express').Router();
const { authorize } = require('../middleware/rbac');
const { validate, validateParams, validateQuery } = require('../middleware/validate');
const { uuidParam } = require('../validators/common.validator');
const {
  createUserSchema,
  updateUserSchema,
  userQuerySchema,
} = require('../validators/user.validator');
const userController = require('../controllers/user.controller');

router.get('/', authorize('ADMIN'), validateQuery(userQuerySchema), userController.list);
router.get('/:id', authorize('ADMIN'), validateParams(uuidParam), userController.getById);
router.post('/', authorize('ADMIN'), validate(createUserSchema), userController.create);
router.patch(
  '/:id',
  authorize('ADMIN'),
  validateParams(uuidParam),
  validate(updateUserSchema),
  userController.update
);
router.delete('/:id', authorize('ADMIN'), validateParams(uuidParam), userController.remove);

module.exports = router;
