const { z } = require('zod');

const uuidParam = z.object({
  id: z.string().uuid('Invalid ID format'),
});

module.exports = { uuidParam };
