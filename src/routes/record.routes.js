const router = require('express').Router();
const { authorize } = require('../middleware/rbac');
const { validate, validateQuery, validateParams } = require('../middleware/validate');
const { uuidParam } = require('../validators/common.validator');
const {
  createRecordSchema,
  updateRecordSchema,
  recordQuerySchema,
} = require('../validators/record.validator');
const recordController = require('../controllers/record.controller');

router.get(
  '/',
  authorize('ANALYST', 'ADMIN'),
  validateQuery(recordQuerySchema),
  recordController.list
);
router.get(
  '/:id',
  authorize('ANALYST', 'ADMIN'),
  validateParams(uuidParam),
  recordController.getById
);
router.post('/', authorize('ADMIN'), validate(createRecordSchema), recordController.create);
router.patch(
  '/:id',
  authorize('ADMIN'),
  validateParams(uuidParam),
  validate(updateRecordSchema),
  recordController.update
);
router.delete('/:id', authorize('ADMIN'), validateParams(uuidParam), recordController.remove);

module.exports = router;
