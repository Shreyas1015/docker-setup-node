# Zorvyn -- Finance Dashboard Backend

Production-grade REST API backend for a finance dashboard with role-based access control, JWT access/refresh token authentication, and comprehensive security hardening. Built with Node.js, Express 5, PostgreSQL, and Sequelize.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js 24 | Non-blocking I/O for concurrent API requests, native JSON handling |
| Framework | Express 5 | Minimal, middleware-driven -- every architectural decision is explicit |
| Database | PostgreSQL | Relational data with ACID transactions, native aggregation (SUM, GROUP BY), UUID primary keys |
| ORM | Sequelize 6 | Mature ORM with paranoid soft-delete, scopes for field exclusion, raw SQL escape hatch for trends |
| Validation | Zod 4 | Composable schemas with structured field-level error messages |
| Auth | JWT (HS256) + bcrypt (12 rounds) | Short-lived access tokens (15 min) + rotating refresh tokens (7 days, httpOnly cookie) |
| Logging | Winston | Structured JSON logs, log levels per environment, request ID correlation, sensitive field redaction |
| Security | Helmet + express-rate-limit + cookie-parser | Explicit CSP/HSTS/frameguard, brute-force protection, secure cookie handling for refresh tokens |
| Compression | gzip | Response compression for bandwidth efficiency |

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> && cd zorvyn
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env:
#   DATABASE_URL        — PostgreSQL connection string
#   JWT_SECRET          — Access token signing secret (min 32 characters)
#   JWT_REFRESH_SECRET  — Refresh token signing secret (min 32 characters, different from JWT_SECRET)
#   CORS_ORIGIN         — Allowed origin for CORS (e.g., http://localhost:3000)
#
# Optional (have defaults):
#   JWT_ACCESS_EXPIRES_IN   — Access token TTL (default: 15m)
#   JWT_REFRESH_EXPIRES_IN  — Refresh token TTL (default: 7d)

# 3. Database setup
# Ensure your PostgreSQL database exists and tables are created.
# If starting fresh, run migrations:
npx sequelize-cli db:migrate           # Create tables (user, financial_record, refresh_token, security_event)
npm run seed                            # Seed 3 users + 20 records

# 4. Start server
npm run dev                            # http://localhost:3000
```

Verify: `curl http://localhost:3000/health` -> `{"status":"ok","timestamp":"..."}`

## Seed Data

| Email | Role | Password |
|-------|------|----------|
| admin@zorvyn.com | ADMIN | Password1 |
| analyst@zorvyn.com | ANALYST | Password1 |
| viewer@zorvyn.com | VIEWER | Password1 |

Password policy: minimum 8 characters, at least one uppercase letter, one lowercase letter, and one number.

20 financial records seeded across Jan-Mar 2026 with mixed income/expense entries across categories (Salary, Freelance, Rent, Groceries, etc.) to produce meaningful dashboard aggregations.

## Testing with cURL

```bash
# Login as admin (access token in response body, refresh token as httpOnly cookie)
TOKEN=$(curl -s -c cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@zorvyn.com","password":"Password1"}' \
  | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).data.accessToken)")

# Get current user profile
curl -s http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"

# Dashboard summary
curl -s http://localhost:3000/api/v1/dashboard/summary \
  -H "Authorization: Bearer $TOKEN" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).data)"

# List records with filters
curl -s "http://localhost:3000/api/v1/records?type=INCOME&limit=5&sortBy=amount&order=desc" \
  -H "Authorization: Bearer $TOKEN"

# Create a record
curl -s -X POST http://localhost:3000/api/v1/records \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"amount":250000,"type":"EXPENSE","category":"Equipment","date":"2026-04-01","description":"New monitor"}'

# Category breakdown
curl -s http://localhost:3000/api/v1/dashboard/category-breakdown \
  -H "Authorization: Bearer $TOKEN"

# Monthly trends (uses raw SQL GROUP BY for performance)
curl -s http://localhost:3000/api/v1/dashboard/trends \
  -H "Authorization: Bearer $TOKEN"

# Refresh token flow (uses cookie from login)
NEW_TOKEN=$(curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/v1/auth/refresh \
  | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).data.accessToken)")

# Logout (revokes refresh token, clears cookie)
curl -s -b cookies.txt -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer $NEW_TOKEN"

# Verify refresh token is revoked (should return 401)
curl -s -b cookies.txt -X POST http://localhost:3000/api/v1/auth/refresh
```

## API Endpoints

All API routes are prefixed with `/api/v1`. All IDs are UUIDs.

### Auth (Public -- rate limited: 20 req / 15 min)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/auth/register | Register (default role: VIEWER). Returns accessToken + refresh cookie |
| POST | /api/v1/auth/login | Authenticate. Returns accessToken + refresh cookie |
| POST | /api/v1/auth/refresh | Exchange refresh cookie for new access token + rotated refresh cookie |
| POST | /api/v1/auth/logout | Revoke refresh token, clear cookie. Requires Bearer token |
| GET | /api/v1/auth/me | Get current user profile. Requires Bearer token |

### Users (Admin only)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/users | List users (paginated) |
| GET | /api/v1/users/:id | Get user by UUID |
| POST | /api/v1/users | Create user with specific role |
| PATCH | /api/v1/users/:id | Update name, role, or status |
| DELETE | /api/v1/users/:id | Soft delete (sets `deleted_at`) |

### Financial Records

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | /api/v1/records | ANALYST, ADMIN | List with filters, pagination, sorting |
| GET | /api/v1/records/:id | ANALYST, ADMIN | Single record with creator info |
| POST | /api/v1/records | ADMIN | Create record (amount in cents) |
| PATCH | /api/v1/records/:id | ADMIN | Partial update (ownership check) |
| DELETE | /api/v1/records/:id | ADMIN | Soft delete (ownership check) |

**Filtering & pagination:**
```
GET /api/v1/records?type=INCOME&category=Salary&startDate=2026-01-01&endDate=2026-03-31&page=1&limit=10&sortBy=date&order=desc
```

### Dashboard (All authenticated roles)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/dashboard/summary | Total income, expenses, net balance, record count |
| GET | /api/v1/dashboard/category-breakdown | Totals grouped by category + type |
| GET | /api/v1/dashboard/trends | Monthly income vs expense (raw SQL GROUP BY) |
| GET | /api/v1/dashboard/recent | Last N transactions (`?limit=5`, max 20) |

All dashboard endpoints accept optional `?startDate=...&endDate=...` date range filters.

### Utility

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check (no auth required) |

## RBAC Permission Matrix

| Resource | VIEWER | ANALYST | ADMIN |
|----------|--------|---------|-------|
| Auth (register/login/refresh/logout/me) | Yes | Yes | Yes |
| User management | -- | -- | Yes |
| Read records | -- | Yes | Yes |
| Write/delete records | -- | -- | Yes |
| Dashboard summaries | Yes | Yes | Yes |

Unauthorized access attempts log a `PERMISSION_DENIED` security event.

## Project Structure

```
zorvyn/
├── db/
│   ├── seed.js                    # Seeds 3 users + 20 financial records
│   ├── migrations/                # Sequelize CLI migrations
│   └── seeders/                   # Sequelize CLI seeders
│
├── src/
│   ├── server.js                  # Entry point -- DB authenticate, starts server, graceful shutdown
│   ├── app.js                     # Express app -- middleware stack, route mounting
│   │
│   ├── config/
│   │   ├── index.js               # Env config with fail-fast validation
│   │   └── database.js            # Sequelize CLI database config
│   │
│   ├── models/
│   │   ├── index.js               # Model registry -- imports all models, sets up associations
│   │   ├── User.js                # User model (paranoid soft-delete, defaultScope excludes passwordHash)
│   │   ├── FinancialRecord.js     # Financial record model (paranoid soft-delete, indexed)
│   │   ├── RefreshToken.js        # Refresh token model (unique tokenHash, family tracking)
│   │   └── SecurityEvent.js       # Security event model (JSONB metadata, immutable audit log)
│   │
│   ├── lib/
│   │   ├── sequelize.js           # Sequelize instance (connection pool, logging config)
│   │   ├── logger.js              # Winston structured logger with sensitive field redaction
│   │   └── securityLogger.js      # Security event logger (AUTH_SUCCESS, AUTH_FAILURE, ACCOUNT_LOCKED, TOKEN_REVOKED, PERMISSION_DENIED)
│   │
│   ├── middleware/
│   │   ├── auth.js                # JWT verification (jwt.verify, never jwt.decode)
│   │   ├── rbac.js                # authorize(...roles) factory middleware
│   │   ├── validate.js            # Zod body/query validation middleware
│   │   ├── errorHandler.js        # Global catch -- Sequelize error mapping, error hierarchy, no stack leaks
│   │   ├── requestId.js           # UUID per request -> X-Request-Id header
│   │   └── requestLogger.js       # Winston HTTP request/response logging
│   │
│   ├── routes/
│   │   ├── auth.routes.js         # POST /register, /login, /refresh, /logout; GET /me
│   │   ├── user.routes.js         # CRUD /users (Admin only, UUID param validation)
│   │   ├── record.routes.js       # CRUD /records + filtering (UUID param validation, ownership checks)
│   │   └── dashboard.routes.js    # GET /summary, /category-breakdown, /trends, /recent
│   │
│   ├── controllers/               # Thin -- extract input -> call service -> respond
│   │   ├── auth.controller.js
│   │   ├── user.controller.js
│   │   ├── record.controller.js
│   │   └── dashboard.controller.js
│   │
│   ├── services/                  # ALL business logic -- no HTTP concepts
│   │   ├── auth.service.js        # Register, Login, Refresh (rotation + compromise detection), Logout, Me
│   │   ├── user.service.js        # User CRUD, role/status management
│   │   ├── record.service.js      # Record CRUD, filter builder, pagination, ownership checks
│   │   └── dashboard.service.js   # Aggregation: sum, groupBy, trends (raw SQL GROUP BY)
│   │
│   ├── validators/                # Zod schemas per domain
│   │   ├── common.validator.js    # UUID param validation, shared schemas
│   │   ├── auth.validator.js      # Login, register (password policy: 8+ chars, upper, lower, number)
│   │   ├── user.validator.js
│   │   ├── record.validator.js
│   │   └── dashboard.validator.js # Date range query validation
│   │
│   └── utils/
│       ├── apiError.js            # Error hierarchy: AppError -> ValidationError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError
│       ├── apiResponse.js         # success(), created(), paginated() helpers -- all include meta block
│       └── asyncHandler.js        # Wraps async handlers -> auto-forwards errors
│
├── postman/
│   └── Zorvyn_Finance_API.postman_collection.json
│
├── .env.example                   # Template (committed)
├── .env                           # Secrets (git-ignored)
├── .sequelizerc                   # Sequelize CLI path config
├── .gitignore
├── package.json
└── README.md
```

## Architecture & Design

### Layered Architecture

```
Client (Postman / Browser)
     │
     ▼
┌────────────────────────────────────────────────────────────────┐
│  MIDDLEWARE STACK (in order)                                    │
│  helmet(CSP,HSTS,frameguard) -> cors(origin,credentials) ->   │
│  cookie-parser -> rate-limit -> compression -> json ->         │
│  requestId -> requestLogger -> [auth] -> [rbac] ->             │
│  [validate] -> controller                                      │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  CONTROLLER (thin)                                              │
│  Extract req data -> call service -> format response            │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  SERVICE (all business logic)                                   │
│  Validation rules, aggregation, role checks, ownership checks   │
│  Refresh token rotation, account lockout, security event logging│
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  SEQUELIZE (paranoid soft-delete, default scopes)               │
│  Auto-filters deletedAt on all reads for User/FinancialRecord  │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
                  ┌──────────────┐
                  │  PostgreSQL  │
                  └──────────────┘
```

### Auth Flow: Access Token + Refresh Token

```
Client                          Server                          Database
  │                               │                               │
  │  POST /api/v1/auth/login      │                               │
  │  {email, password}            │                               │
  │──────────────────────────────>│                               │
  │                               │  Verify credentials           │
  │                               │  Check account lockout        │
  │                               │  Log AUTH_SUCCESS/AUTH_FAILURE │
  │                               │──────────────────────────────>│
  │                               │                               │
  │  200 {accessToken}            │  Generate refresh token       │
  │  Set-Cookie: refreshToken     │  Store in refresh_token table │
  │  (httpOnly, secure, 7d)       │  with token family ID         │
  │<──────────────────────────────│                               │
  │                               │                               │
  │  POST /api/v1/auth/refresh    │                               │
  │  Cookie: refreshToken=...     │                               │
  │──────────────────────────────>│                               │
  │                               │  Validate refresh token       │
  │                               │  Rotate: invalidate old,      │
  │                               │  issue new (same family)      │
  │                               │  Compromise detection:        │
  │                               │  reuse -> revoke entire family │
  │  200 {accessToken}            │──────────────────────────────>│
  │  Set-Cookie: refreshToken     │                               │
  │  (new rotated token)          │                               │
  │<──────────────────────────────│                               │
  │                               │                               │
  │  POST /api/v1/auth/logout     │                               │
  │  Authorization: Bearer ...    │                               │
  │──────────────────────────────>│                               │
  │                               │  Revoke refresh token         │
  │                               │  Clear cookie                 │
  │                               │  Log TOKEN_REVOKED            │
  │  200 {message}                │──────────────────────────────>│
  │<──────────────────────────────│                               │
```

### Key Design Decisions

| Decision | Alternative | Rationale |
|----------|------------|-----------|
| Monolith (layered) | Microservices, hexagonal | Assignment scope is one product -- monolith is the right architecture. Over-engineering signals poor judgment |
| Express 5 | Fastify | Explicit middleware control -- every architectural decision is visible and reviewable |
| JavaScript | TypeScript | Zero config, no compile step. Assignment evaluates logic and structure, not types |
| Sequelize | Prisma, raw SQL | Mature ORM with built-in paranoid soft-delete, scopes for field exclusion, raw SQL escape hatch for complex aggregations |
| PostgreSQL | SQLite | Real aggregation queries (SUM, GROUP BY), proper enum/index support, native UUID type |
| UUID primary keys | Auto-increment integers | Non-enumerable, no information leakage about record count or creation order |
| Access + refresh tokens | Single long-lived JWT | Short-lived access tokens limit exposure window; refresh tokens enable secure session management without re-authentication |
| httpOnly cookie for refresh | Refresh token in response body | Immune to XSS -- JavaScript cannot read httpOnly cookies |
| Refresh token rotation | Static refresh tokens | Detects token theft via family-based reuse detection -- if an old token is reused, the entire family is revoked |
| No repository layer | Repository pattern | Sequelize IS the data access layer -- an extra abstraction adds files and indirection without benefit at this scale |
| Integer cents for amounts | Float, Decimal | Avoids `0.1 + 0.2 !== 0.3` precision bugs. Industry standard for financial data |
| Sequelize `paranoid` soft delete | Manual `deletedAt` filtering | Built-in `paranoid: true` makes it impossible to forget the filter -- prevents accidental data leaks on all query types |
| Sequelize `defaultScope` | Manual field exclusion | `defaultScope` with `attributes: { exclude: ['password_hash'] }` ensures passwordHash is never returned unless explicitly requested via `scope('withPassword')` |
| Error class hierarchy | Flat error codes | `AppError -> ValidationError, UnauthorizedError, ...` enables type-safe catch blocks and consistent HTTP status mapping |
| `asyncHandler` wrapper | try/catch in every controller | DRY -- one utility replaces 50+ lines of boilerplate across controller methods |
| Winston with redaction | console.log | Structured JSON logs, log levels, request ID correlation, automatic redaction of passwords/tokens/secrets |
| Raw SQL for trends | Sequelize groupBy | `GROUP BY TO_CHAR(date, 'YYYY-MM')` with conditional SUM is cleaner as raw SQL; avoids complex Sequelize `fn()` nesting for date formatting |

## Production-Grade Patterns

| Pattern | Implementation |
|---------|---------------|
| **Refresh Token Rotation** | Every refresh issues a new token and invalidates the old one. Family-based tracking: if a revoked token is reused, the entire token family is revoked (compromise detection) |
| **Account Lockout** | 5 failed login attempts locks the account for 15 minutes. Logs `ACCOUNT_LOCKED` security event |
| **Security Event Logging** | `AUTH_SUCCESS`, `AUTH_FAILURE`, `ACCOUNT_LOCKED`, `TOKEN_REVOKED`, `PERMISSION_DENIED` events persisted to the `security_event` table with user ID, IP, user agent, and timestamp |
| **Log Redaction** | Passwords, tokens, and secrets are automatically replaced with `[REDACTED]` in all log output |
| **Ownership Checks** | Record update/delete operations verify the requesting user owns the record (or is authorized) |
| **UUID Param Validation** | All `:id` route parameters are validated as UUIDs before hitting the database |
| **Structured Logging** | Winston JSON logs with timestamp, log level, service name, request ID |
| **Request Tracing** | UUID per request (`X-Request-Id` header), threaded through all log entries |
| **Soft Delete (Paranoid)** | Sequelize `paranoid: true` auto-filters `deleted_at IS NULL` on all queries (findAll, findOne, count, destroy) for User and FinancialRecord models |
| **Password Field Exclusion** | Sequelize `defaultScope` excludes `password_hash` from all User queries. `scope('withPassword')` used only for login verification |
| **Async Error Handling** | `asyncHandler()` wrapper catches rejected promises and forwards to error handler |
| **Sequelize Error Mapping** | `UniqueConstraintError` -> 409 (conflict), `ForeignKeyConstraintError` -> 400 (FK violation), `ValidationError` -> 400 (invalid data) |
| **Rate Limiting** | Global: 100 req/15min. Auth: 20 req/15min (brute-force protection) |
| **Security Headers** | Helmet configured explicitly: CSP, HSTS, X-Frame-Options (frameguard), X-Content-Type-Options |
| **CORS** | Explicit origin from `CORS_ORIGIN` env var, `credentials: true` for cookie transport |
| **Cookie-Parser** | Parses refresh token from httpOnly cookies on `/auth/refresh` |
| **Graceful Shutdown** | SIGTERM/SIGINT -> stop accepting connections -> close Sequelize connection pool -> exit |
| **Unhandled Error Safety** | `unhandledRejection` and `uncaughtException` handlers log and exit cleanly |
| **Request Body Limit** | 10kb JSON limit prevents payload abuse |
| **Response Compression** | gzip via `compression` middleware |
| **Fail-Fast Config** | Missing `DATABASE_URL`, `JWT_SECRET`, or `JWT_REFRESH_SECRET` -> crash at startup with clear message |

## Response Formats

All responses include a `meta` block with `requestId` (for tracing) and `timestamp`.

### Success
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbG...",
    "user": { "id": "a1b2c3d4-...", "email": "admin@zorvyn.com", "role": "ADMIN" }
  },
  "message": "Login successful",
  "meta": {
    "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "timestamp": "2026-04-01T12:00:00.000Z"
  }
}
```

### Paginated
```json
{
  "success": true,
  "data": [{ "id": "b2c3d4e5-...", "amount": 500000, "type": "INCOME", "category": "Salary" }],
  "pagination": { "page": 1, "limit": 10, "total": 20, "totalPages": 2 },
  "message": "Success",
  "meta": {
    "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "timestamp": "2026-04-01T12:00:00.000Z"
  }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" },
      { "field": "password", "message": "Password must be at least 8 characters with uppercase, lowercase, and number" }
    ]
  },
  "meta": {
    "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "timestamp": "2026-04-01T12:00:00.000Z"
  }
}
```

### Error Codes (machine-readable)

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Zod schema validation failed (field-level details included) |
| `MALFORMED_JSON` | 400 | Request body is not valid JSON |
| `UNAUTHORIZED` | 401 | No token, invalid signature, expired token |
| `ACCOUNT_LOCKED` | 401 | Too many failed login attempts (locked 15 min) |
| `FORBIDDEN` | 403 | Role lacks permission for this resource |
| `NOT_FOUND` | 404 | Resource does not exist or was soft-deleted |
| `CONFLICT` | 409 | Duplicate email on registration or user creation |
| `RATE_LIMITED` | 429 | Too many requests in time window |
| `INTERNAL_ERROR` | 500 | Unexpected -- full stack logged via Winston, generic message to client |

## Error Handling

Error class hierarchy: `AppError` is the base class. Subclasses map to specific HTTP semantics:

```
AppError (base)
  ├── ValidationError    (400)
  ├── UnauthorizedError  (401)
  ├── ForbiddenError     (403)
  ├── NotFoundError      (404)
  └── ConflictError      (409)
```

All errors include a machine-readable `error.code` string for client-side branching, plus the `meta` block for request tracing.

## Data Model

All primary keys are UUIDs (`uuid` type in PostgreSQL, generated with `gen_random_uuid()`).

```
┌───────────────────────┐       ┌──────────────────────────────┐
│        User           │       │     FinancialRecord          │
├───────────────────────┤       ├──────────────────────────────┤
│ id         UUID PK    │───┐   │ id          UUID PK          │
│ email      VARCHAR UK │   │   │ amount      INT (cents)      │
│ password_hash VARCHAR │   │   │ type        ENUM(INC/EXP)    │
│ name       VARCHAR    │   │   │ category    VARCHAR           │
│ role       ENUM       │   └──>│ created_by  UUID FK           │
│ status     ENUM       │       │ date        DATE              │
│ failed_login_attempts │       │ description TEXT nullable     │
│ locked_until TIMESTAMP│       │ created_at  TIMESTAMPTZ      │
│ created_at TIMESTAMPTZ│       │ updated_at  TIMESTAMPTZ      │
│ updated_at TIMESTAMPTZ│       │ deleted_at  TIMESTAMPTZ      │
│ deleted_at TIMESTAMPTZ│       └──────────────────────────────┘
└───────────────────────┘
         │
         │ 1:N
         ▼
┌───────────────────────┐       ┌──────────────────────────────┐
│    RefreshToken        │       │     SecurityEvent            │
├───────────────────────┤       ├──────────────────────────────┤
│ id         UUID PK    │       │ id          UUID PK          │
│ token_hash VARCHAR UK │       │ type        VARCHAR           │
│ user_id    UUID FK    │       │   (AUTH_SUCCESS,              │
│ family_id  UUID       │       │    AUTH_FAILURE,              │
│ expires_at TIMESTAMPTZ│       │    ACCOUNT_LOCKED,            │
│ revoked_at TIMESTAMPTZ│       │    TOKEN_REVOKED,             │
│ created_at TIMESTAMPTZ│       │    PERMISSION_DENIED)         │
└───────────────────────┘       │ user_id    UUID FK nullable  │
                                │ ip         VARCHAR            │
                                │ user_agent TEXT               │
                                │ metadata   JSONB nullable     │
                                │ created_at TIMESTAMPTZ        │
                                └──────────────────────────────┘

Enums: Role (VIEWER, ANALYST, ADMIN)
       UserStatus (ACTIVE, INACTIVE)
       RecordType (INCOME, EXPENSE)

Indexes: type, date, category, (type+date) composite, created_by FK
         refresh_token: token_hash (unique), user_id, family_id
         security_event: type, user_id, created_at
```

**Amount convention:** Stored as integers in cents. `500000` = $5,000.00. Avoids floating-point precision errors.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `JWT_SECRET` | Yes | -- | Access token signing secret (min 32 chars) |
| `JWT_REFRESH_SECRET` | Yes | -- | Refresh token signing secret (min 32 chars) |
| `CORS_ORIGIN` | Yes | -- | Allowed origin for CORS (e.g., `http://localhost:3000`) |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token TTL |
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `development` | Environment (`development`, `production`) |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window in ms |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |
| `LOG_LEVEL` | No | `info` | Winston log level |

## Assumptions

1. **Single-tenant** -- no multi-org/workspace support needed
2. **Admin seeded** -- no self-registration as admin (prevents privilege escalation)
3. **Default role = VIEWER** -- least privilege principle on registration
4. **Amounts in cents** -- integer math avoids `0.1 + 0.2 !== 0.3`
5. **Free-text categories** -- not a fixed enum (flexible for the user)
6. **Access token 15 min, refresh token 7 days** -- short access window limits exposure; refresh enables seamless UX
7. **Soft delete** -- financial records never permanently destroyed (audit trail)
8. **Inactive = blocked** -- inactive users cannot authenticate, not just hidden
9. **bcrypt 12 rounds** -- industry standard (balances security vs latency)
10. **ON DELETE RESTRICT** -- deleting a user does not cascade-delete their records
11. **Refresh token rotation** -- every refresh invalidates the previous token; reuse of an old token revokes the entire family (compromise detection)
12. **Account lockout** -- 5 failed attempts triggers a 15-minute lockout to mitigate brute-force attacks
13. **Security events persisted** -- all auth and access events are written to the database for audit, not just logged to stdout
14. **UUID primary keys** -- non-enumerable identifiers prevent information leakage about entity count or creation order
