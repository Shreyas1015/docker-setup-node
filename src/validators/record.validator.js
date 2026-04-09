const { z } = require('zod');

const createRecordSchema = z.object({
  amount: z.number().int().positive('Amount must be a positive integer (in cents)'),
  type: z.enum(['INCOME', 'EXPENSE']),
  category: z.string().min(1, 'Category is required').max(100).trim(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  description: z.string().max(1000).optional(),
});

const updateRecordSchema = z
  .object({
    amount: z.number().int().positive('Amount must be a positive integer').optional(),
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
    category: z.string().min(1).max(100).trim().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format')
      .optional(),
    description: z.string().max(1000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

const recordQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
    category: z.string().optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    sortBy: z.enum(['date', 'amount', 'createdAt']).default('date'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    { message: 'startDate must be before or equal to endDate' }
  );

module.exports = { createRecordSchema, updateRecordSchema, recordQuerySchema };
