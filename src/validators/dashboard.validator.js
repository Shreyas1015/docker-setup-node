const { z } = require('zod');

const dashboardQuerySchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
      .optional(),
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

const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

module.exports = { dashboardQuerySchema, recentQuerySchema };
