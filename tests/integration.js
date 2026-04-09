/**
 * Integration test runner for all database use cases.
 * Tests auth, user CRUD, record CRUD, dashboard aggregations, and RBAC.
 * Run: node tests/integration.js
 */

const http = require('http');

const BASE = 'http://localhost:8080';
let TOKEN = '';
let RECORD_ID = '';
let USER_ID = '';
let PASS = 0;
let FAIL = 0;

async function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function check(name, condition, detail) {
  if (condition) {
    PASS++;
    // eslint-disable-next-line no-console
    console.log('\x1b[32mPASS\x1b[0m', name);
  } else {
    FAIL++;
    // eslint-disable-next-line no-console
    console.log('\x1b[31mFAIL\x1b[0m', name, detail || '');
  }
}

async function run() {
  // ═══ AUTH ═══
  // eslint-disable-next-line no-console
  console.log('\n═══ AUTH TESTS ═══');

  // Login
  let r = await req('POST', '/api/v1/auth/login', {
    email: 'admin@zorvyn.com',
    password: 'Password1',
  });
  check('Login success', r.status === 200 && r.body.success);
  check('Login returns token', !!r.body.data?.accessToken);
  check('Login excludes passwordHash', !r.body.data?.user?.passwordHash);
  check(
    'Login excludes deleted_at',
    !Object.keys(r.body.data?.user || {}).includes('deleted_at')
  );
  check('Login excludes internal fields', !r.body.data?.user?.failedLoginAttempts);
  TOKEN = r.body.data?.accessToken;

  // Me
  r = await req('GET', '/api/v1/auth/me', null, { Authorization: 'Bearer ' + TOKEN });
  check('Me success', r.status === 200 && r.body.success);
  check('Me excludes passwordHash', !r.body.data?.passwordHash);
  check('Me has email', r.body.data?.email === 'admin@zorvyn.com');

  // Bad login
  r = await req('POST', '/api/v1/auth/login', {
    email: 'admin@zorvyn.com',
    password: 'wrong',
  });
  check('Bad login returns 401', r.status === 401);

  // Register duplicate
  r = await req('POST', '/api/v1/auth/register', {
    email: 'admin@zorvyn.com',
    password: 'Password1',
    name: 'Dup',
  });
  check('Duplicate register returns 409', r.status === 409);

  // Register new
  r = await req('POST', '/api/v1/auth/register', {
    email: 'newuser' + Date.now() + '@test.com',
    password: 'Password1',
    name: 'New',
  });
  check('Register new user success', r.status === 201 && r.body.success);

  // ═══ USERS ═══
  // eslint-disable-next-line no-console
  console.log('\n═══ USER TESTS ═══');

  // List users
  r = await req('GET', '/api/v1/users', null, { Authorization: 'Bearer ' + TOKEN });
  check('List users success', r.status === 200 && r.body.success);
  check('List users has pagination', !!r.body.pagination);
  check('List users has data', Array.isArray(r.body.data));
  check('List users excludes passwordHash', !r.body.data?.[0]?.passwordHash);

  // Get user by ID
  USER_ID = r.body.data?.[0]?.id;
  r = await req('GET', '/api/v1/users/' + USER_ID, null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Get user by ID success', r.status === 200 && r.body.success);
  check('Get user excludes passwordHash', !r.body.data?.passwordHash);

  // Create user
  r = await req(
    'POST',
    '/api/v1/users',
    {
      email: 'created' + Date.now() + '@test.com',
      password: 'Password1',
      name: 'Created',
      role: 'ANALYST',
    },
    { Authorization: 'Bearer ' + TOKEN }
  );
  check('Create user success', r.status === 201 && r.body.success);
  const createdUserId = r.body.data?.id;
  check('Created user has role', r.body.data?.role === 'ANALYST');

  // Update user
  r = await req(
    'PATCH',
    '/api/v1/users/' + createdUserId,
    { name: 'Updated Name' },
    { Authorization: 'Bearer ' + TOKEN }
  );
  check('Update user success', r.status === 200 && r.body.success);
  check('Update user name changed', r.body.data?.name === 'Updated Name');

  // Delete user (soft delete)
  r = await req('DELETE', '/api/v1/users/' + createdUserId, null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Delete user success', r.status === 200);

  // Get deleted user (should be 404 due to paranoid)
  r = await req('GET', '/api/v1/users/' + createdUserId, null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Deleted user not found (soft delete)', r.status === 404);

  // ═══ RECORDS ═══
  // eslint-disable-next-line no-console
  console.log('\n═══ RECORD TESTS ═══');

  // List records
  r = await req('GET', '/api/v1/records', null, { Authorization: 'Bearer ' + TOKEN });
  check('List records success', r.status === 200 && r.body.success);
  check('List records has pagination', !!r.body.pagination);

  // List with type filter
  r = await req('GET', '/api/v1/records?type=INCOME&limit=3', null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Filtered records success', r.status === 200);
  check(
    'Filtered records all INCOME',
    r.body.data?.every((rec) => rec.type === 'INCOME')
  );

  // List with date range
  r = await req('GET', '/api/v1/records?startDate=2026-02-01&endDate=2026-02-28', null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Date range filter success', r.status === 200);

  // Create record
  r = await req(
    'POST',
    '/api/v1/records',
    {
      amount: 99900,
      type: 'EXPENSE',
      category: 'TestCat',
      date: '2026-04-01',
      description: 'Test record',
    },
    { Authorization: 'Bearer ' + TOKEN }
  );
  check('Create record success', r.status === 201 && r.body.success);
  RECORD_ID = r.body.data?.id;
  check('Create record has amount', r.body.data?.amount === 99900);

  // Get record by ID
  r = await req('GET', '/api/v1/records/' + RECORD_ID, null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Get record by ID success', r.status === 200);
  check('Get record includes creator', !!r.body.data?.creator);

  // Update record
  r = await req(
    'PATCH',
    '/api/v1/records/' + RECORD_ID,
    { amount: 88800 },
    { Authorization: 'Bearer ' + TOKEN }
  );
  check('Update record success', r.status === 200);
  check('Update record amount changed', r.body.data?.amount === 88800);

  // Delete record (soft delete)
  r = await req('DELETE', '/api/v1/records/' + RECORD_ID, null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Delete record success', r.status === 200);

  // Get deleted record (should be 404)
  r = await req('GET', '/api/v1/records/' + RECORD_ID, null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Deleted record not found (soft delete)', r.status === 404);

  // ═══ DASHBOARD ═══
  // eslint-disable-next-line no-console
  console.log('\n═══ DASHBOARD TESTS ═══');

  // Summary
  r = await req('GET', '/api/v1/dashboard/summary', null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Summary success', r.status === 200 && r.body.success);
  check('Summary has totalIncome', typeof r.body.data?.totalIncome === 'number');
  check('Summary has totalExpenses', typeof r.body.data?.totalExpenses === 'number');
  check('Summary has netBalance', typeof r.body.data?.netBalance === 'number');
  check('Summary has recordCount', typeof r.body.data?.recordCount === 'number');

  // Summary with date range
  r = await req('GET', '/api/v1/dashboard/summary?startDate=2026-01-01&endDate=2026-01-31', null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Summary with date range success', r.status === 200);

  // Category breakdown
  r = await req('GET', '/api/v1/dashboard/category-breakdown', null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Category breakdown success', r.status === 200 && r.body.success);
  check('Category breakdown has data', Array.isArray(r.body.data));
  check(
    'Breakdown item has fields',
    r.body.data?.[0]?.category &&
      r.body.data?.[0]?.type &&
      typeof r.body.data?.[0]?.total === 'number'
  );

  // Trends (raw SQL)
  r = await req('GET', '/api/v1/dashboard/trends', null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Trends success', r.status === 200 && r.body.success);
  check('Trends has data', Array.isArray(r.body.data));
  check(
    'Trends item has month/income/expense',
    r.body.data?.[0]?.month && typeof r.body.data?.[0]?.income === 'number'
  );

  // Recent
  r = await req('GET', '/api/v1/dashboard/recent?limit=5', null, {
    Authorization: 'Bearer ' + TOKEN,
  });
  check('Recent success', r.status === 200 && r.body.success);
  check('Recent has data', Array.isArray(r.body.data));
  check('Recent respects limit', r.body.data?.length <= 5);

  // ═══ RBAC ═══
  // eslint-disable-next-line no-console
  console.log('\n═══ RBAC TESTS ═══');

  // Login as viewer
  r = await req('POST', '/api/v1/auth/login', {
    email: 'viewer@zorvyn.com',
    password: 'Password1',
  });
  const viewerToken = r.body.data?.accessToken;
  check('Viewer login success', !!viewerToken);

  // Viewer cannot access users
  r = await req('GET', '/api/v1/users', null, { Authorization: 'Bearer ' + viewerToken });
  check('Viewer blocked from /users', r.status === 403);

  // Viewer cannot access records
  r = await req('GET', '/api/v1/records', null, { Authorization: 'Bearer ' + viewerToken });
  check('Viewer blocked from /records', r.status === 403);

  // Viewer CAN access dashboard
  r = await req('GET', '/api/v1/dashboard/summary', null, {
    Authorization: 'Bearer ' + viewerToken,
  });
  check('Viewer can access dashboard', r.status === 200);

  // Login as analyst
  r = await req('POST', '/api/v1/auth/login', {
    email: 'analyst@zorvyn.com',
    password: 'Password1',
  });
  const analystToken = r.body.data?.accessToken;

  // Analyst can read records
  r = await req('GET', '/api/v1/records', null, { Authorization: 'Bearer ' + analystToken });
  check('Analyst can read records', r.status === 200);

  // Analyst cannot create records
  r = await req(
    'POST',
    '/api/v1/records',
    { amount: 100, type: 'INCOME', category: 'Test', date: '2026-01-01' },
    { Authorization: 'Bearer ' + analystToken }
  );
  check('Analyst blocked from creating records', r.status === 403);

  // No auth
  r = await req('GET', '/api/v1/auth/me');
  check('No auth returns 401', r.status === 401);

  // ═══ SUMMARY ═══
  // eslint-disable-next-line no-console
  console.log('\n═══════════════════════════════');
  // eslint-disable-next-line no-console
  console.log('PASSED: ' + PASS + '/' + (PASS + FAIL));
  // eslint-disable-next-line no-console
  console.log('FAILED: ' + FAIL + '/' + (PASS + FAIL));
  if (FAIL > 0) {
    // eslint-disable-next-line no-console
    console.log('STATUS: SOME TESTS FAILED');
  } else {
    // eslint-disable-next-line no-console
    console.log('STATUS: ALL TESTS PASSED');
  }
}

run().catch((e) => console.error('Test runner error:', e));
