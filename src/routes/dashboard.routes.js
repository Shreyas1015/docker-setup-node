const router = require('express').Router();
const { authorize } = require('../middleware/rbac');
const { validateQuery } = require('../middleware/validate');
const { dashboardQuerySchema, recentQuerySchema } = require('../validators/dashboard.validator');
const dashboardController = require('../controllers/dashboard.controller');

router.get(
  '/summary',
  authorize('VIEWER', 'ANALYST', 'ADMIN'),
  validateQuery(dashboardQuerySchema),
  dashboardController.summary
);
router.get(
  '/category-breakdown',
  authorize('VIEWER', 'ANALYST', 'ADMIN'),
  validateQuery(dashboardQuerySchema),
  dashboardController.categoryBreakdown
);
router.get(
  '/trends',
  authorize('VIEWER', 'ANALYST', 'ADMIN'),
  validateQuery(dashboardQuerySchema),
  dashboardController.trends
);
router.get(
  '/recent',
  authorize('VIEWER', 'ANALYST', 'ADMIN'),
  validateQuery(recentQuerySchema),
  dashboardController.recent
);

module.exports = router;
