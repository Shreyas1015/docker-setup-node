const { z } = require('zod');
const { passwordSchema } = require('./auth.validator');

const createUserSchema = z.object({
  email: z.string().email('Invalid email format').toLowerCase(),
  password: passwordSchema,
  name: z.string().min(1, 'Name is required').max(100).trim(),
  role: z.enum(['VIEWER', 'ANALYST', 'ADMIN']).optional(),
});

const updateUserSchema = z
  .object({
    name: z.string().min(1).max(100).trim().optional(),
    role: z.enum(['VIEWER', 'ANALYST', 'ADMIN']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

const userQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

module.exports = { createUserSchema, updateUserSchema, userQuerySchema };
