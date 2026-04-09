const { z } = require('zod');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Must contain at least one number');

const registerSchema = z.object({
  email: z.string().email('Invalid email format').toLowerCase(),
  password: passwordSchema,
  name: z.string().min(1, 'Name is required').max(100).trim(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

module.exports = { registerSchema, loginSchema, passwordSchema };
