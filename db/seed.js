const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed production database');
    process.exit(1);
  }

  // Load models (triggers dotenv via config)
  const {
    sequelize,
    User,
    FinancialRecord,
    RefreshToken,
    SecurityEvent,
  } = require('../src/models');

  await sequelize.authenticate();

  // Clean existing data (order matters for FK constraints)
  await SecurityEvent.destroy({ where: {}, force: true });
  await RefreshToken.destroy({ where: {}, force: true });
  await FinancialRecord.destroy({ where: {}, force: true });
  await User.destroy({ where: {}, force: true });

  // Password meets new policy: 8+ chars, uppercase, lowercase, number
  const hash = await bcrypt.hash('Password1', SALT_ROUNDS);

  // Create users — one per role
  const admin = await User.scope('withPassword').create({
    email: 'admin@zorvyn.com',
    passwordHash: hash,
    name: 'Admin User',
    role: 'ADMIN',
    status: 'ACTIVE',
  });

  await User.scope('withPassword').create({
    email: 'analyst@zorvyn.com',
    passwordHash: hash,
    name: 'Analyst User',
    role: 'ANALYST',
    status: 'ACTIVE',
  });

  await User.scope('withPassword').create({
    email: 'viewer@zorvyn.com',
    passwordHash: hash,
    name: 'Viewer User',
    role: 'VIEWER',
    status: 'ACTIVE',
  });

  // Create financial records — 20 entries across 3 months
  const records = [
    {
      amount: 500000,
      type: 'INCOME',
      category: 'Salary',
      date: new Date('2026-01-15'),
      description: 'January salary',
    },
    {
      amount: 75000,
      type: 'INCOME',
      category: 'Freelance',
      date: new Date('2026-01-20'),
      description: 'Web design project',
    },
    {
      amount: 12000,
      type: 'INCOME',
      category: 'Investment',
      date: new Date('2026-01-25'),
      description: 'Dividend payment',
    },
    {
      amount: 150000,
      type: 'EXPENSE',
      category: 'Rent',
      date: new Date('2026-01-01'),
      description: 'Monthly rent',
    },
    {
      amount: 35000,
      type: 'EXPENSE',
      category: 'Groceries',
      date: new Date('2026-01-10'),
      description: 'Weekly groceries',
    },
    {
      amount: 8500,
      type: 'EXPENSE',
      category: 'Transport',
      date: new Date('2026-01-12'),
      description: 'Metro pass',
    },
    {
      amount: 12000,
      type: 'EXPENSE',
      category: 'Utilities',
      date: new Date('2026-01-18'),
      description: 'Electricity bill',
    },
    {
      amount: 500000,
      type: 'INCOME',
      category: 'Salary',
      date: new Date('2026-02-15'),
      description: 'February salary',
    },
    {
      amount: 50000,
      type: 'INCOME',
      category: 'Freelance',
      date: new Date('2026-02-22'),
      description: 'Logo design',
    },
    {
      amount: 8000,
      type: 'INCOME',
      category: 'Refund',
      date: new Date('2026-02-28'),
      description: 'Insurance refund',
    },
    {
      amount: 150000,
      type: 'EXPENSE',
      category: 'Rent',
      date: new Date('2026-02-01'),
      description: 'Monthly rent',
    },
    {
      amount: 42000,
      type: 'EXPENSE',
      category: 'Groceries',
      date: new Date('2026-02-08'),
      description: 'Weekly groceries',
    },
    {
      amount: 15000,
      type: 'EXPENSE',
      category: 'Utilities',
      date: new Date('2026-02-20'),
      description: 'Internet + electricity',
    },
    {
      amount: 500000,
      type: 'INCOME',
      category: 'Salary',
      date: new Date('2026-03-15'),
      description: 'March salary',
    },
    {
      amount: 100000,
      type: 'INCOME',
      category: 'Freelance',
      date: new Date('2026-03-18'),
      description: 'API integration project',
    },
    {
      amount: 15000,
      type: 'INCOME',
      category: 'Investment',
      date: new Date('2026-03-22'),
      description: 'Stock dividend',
    },
    {
      amount: 5000,
      type: 'INCOME',
      category: 'Refund',
      date: new Date('2026-03-25'),
      description: 'Product return refund',
    },
    {
      amount: 150000,
      type: 'EXPENSE',
      category: 'Rent',
      date: new Date('2026-03-01'),
      description: 'Monthly rent',
    },
    {
      amount: 38000,
      type: 'EXPENSE',
      category: 'Groceries',
      date: new Date('2026-03-12'),
      description: 'Weekly groceries',
    },
    {
      amount: 9500,
      type: 'EXPENSE',
      category: 'Transport',
      date: new Date('2026-03-14'),
      description: 'Uber rides',
    },
  ];

  for (const record of records) {
    await FinancialRecord.create({ ...record, createdBy: admin.id });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded: 3 users, ${records.length} financial records`);
  // eslint-disable-next-line no-console
  console.log(
    'Credentials: admin@zorvyn.com / analyst@zorvyn.com / viewer@zorvyn.com — Password: Password1'
  );

  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
