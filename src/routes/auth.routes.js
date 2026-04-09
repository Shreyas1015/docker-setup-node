const router = require('express').Router();
const { validate } = require('../middleware/validate');
const { auth } = require('../middleware/auth');
const { registerSchema, loginSchema } = require('../validators/auth.validator');
const authController = require('../controllers/auth.controller');

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', auth, authController.me);

module.exports = router;
