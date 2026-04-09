const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { User, RefreshToken } = require('../models');
const config = require('../config');
const securityLogger = require('../lib/securityLogger');
const { UnauthorizedError, ConflictError, ForbiddenError } = require('../utils/apiError');

// ─── TOKEN HELPERS ──────────────────────────────────

const generateAccessToken = (user) => {
  return jwt.sign({ userId: user.id, role: user.role, type: 'access' }, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn,
  });
};

const generateRefreshToken = async (userId, familyId = null) => {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const family = familyId || uuidv4();

  await RefreshToken.create({
    tokenHash,
    userId,
    familyId: family,
    expiresAt: new Date(Date.now() + config.jwt.refreshMaxAgeMs),
  });

  return { rawToken, familyId: family };
};

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// ─── ACCOUNT LOCKOUT ────────────────────────────────

const checkLockout = (user) => {
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
    throw new UnauthorizedError(`Account locked. Try again in ${minutesLeft} minutes`);
  }
};

const handleFailedAttempt = async (user, ip) => {
  const attempts = user.failedLoginAttempts + 1;
  const updateData = { failedLoginAttempts: attempts };

  if (attempts >= config.auth.maxFailedAttempts) {
    updateData.lockedUntil = new Date(Date.now() + config.auth.lockoutDurationMs);
    securityLogger.logAccountLocked(user.id, ip);
  }

  await User.unscoped().update(updateData, { where: { id: user.id } });
};

const resetFailedAttempts = async (userId) => {
  await User.unscoped().update(
    { failedLoginAttempts: 0, lockedUntil: null },
    { where: { id: userId } }
  );
};

// ─── PUBLIC METHODS ─────────────────────────────────

const register = async ({ email, password, name }) => {
  const existing = await User.findOne({ where: { email } });
  if (existing) throw new ConflictError('Email already registered');

  const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
  const user = await User.create({ email, passwordHash, name });

  const accessToken = generateAccessToken(user);
  const { rawToken } = await generateRefreshToken(user.id);

  return { user, accessToken, refreshToken: rawToken };
};

const login = async ({ email, password }, ip, userAgent) => {
  const user = await User.scope('withPassword').findOne({ where: { email } });
  if (!user) {
    securityLogger.logAuthFailure(email, ip, userAgent, 'user_not_found');
    throw new UnauthorizedError('Invalid credentials');
  }

  const userData = user.get({ plain: true });
  checkLockout(userData);

  // Same generic message for inactive accounts — prevents account enumeration
  if (userData.status === 'INACTIVE') {
    securityLogger.logAuthFailure(email, ip, userAgent, 'account_inactive');
    throw new UnauthorizedError('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, userData.passwordHash);
  if (!valid) {
    await handleFailedAttempt(userData, ip);
    securityLogger.logAuthFailure(email, ip, userAgent, 'invalid_password');
    throw new UnauthorizedError('Invalid credentials');
  }

  // Success — reset lockout counter
  await resetFailedAttempts(userData.id);

  const publicUser = {
    id: userData.id,
    email: userData.email,
    name: userData.name,
    role: userData.role,
    status: userData.status,
    created_at: userData.created_at,
    updated_at: userData.updated_at,
  };
  const accessToken = generateAccessToken(userData);
  const { rawToken } = await generateRefreshToken(userData.id);

  securityLogger.logAuthSuccess(userData.id, ip, userAgent);
  return { user: publicUser, accessToken, refreshToken: rawToken };
};

const refresh = async (rawRefreshToken) => {
  if (!rawRefreshToken) throw new UnauthorizedError('No refresh token provided');

  const tokenHash = hashToken(rawRefreshToken);

  const storedToken = await RefreshToken.findOne({
    where: { tokenHash },
    include: [{ model: User, as: 'user' }],
  });

  if (!storedToken) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Token was already revoked — possible compromise. Revoke entire family.
  if (storedToken.revokedAt) {
    await RefreshToken.update(
      { revokedAt: new Date() },
      { where: { familyId: storedToken.familyId, revokedAt: null } }
    );
    securityLogger.logTokenFamilyRevoked(storedToken.userId, storedToken.familyId);
    throw new UnauthorizedError('Token reuse detected — all sessions revoked');
  }

  // Token expired
  if (new Date(storedToken.expiresAt) < new Date()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  // Check account is still active (admin may have deactivated since last login)
  const currentUser = await User.findOne({ where: { id: storedToken.userId } });
  if (!currentUser || currentUser.status === 'INACTIVE') {
    throw new ForbiddenError('Account is inactive');
  }

  // Rotate: revoke old, issue new with same family
  await RefreshToken.update({ revokedAt: new Date() }, { where: { id: storedToken.id } });

  const accessToken = generateAccessToken(storedToken.user);
  const { rawToken } = await generateRefreshToken(storedToken.userId, storedToken.familyId);

  return { user: storedToken.user, accessToken, refreshToken: rawToken };
};

const logout = async (rawRefreshToken) => {
  if (!rawRefreshToken) return;

  const tokenHash = hashToken(rawRefreshToken);
  const storedToken = await RefreshToken.findOne({ where: { tokenHash } });

  if (storedToken && !storedToken.revokedAt) {
    await RefreshToken.update({ revokedAt: new Date() }, { where: { id: storedToken.id } });
    securityLogger.logTokenRevoked(storedToken.userId, 'logout');
  }
};

const logoutAll = async (userId) => {
  await RefreshToken.update({ revokedAt: new Date() }, { where: { userId, revokedAt: null } });
  securityLogger.logTokenRevoked(userId, 'logout_all');
};

module.exports = { register, login, refresh, logout, logoutAll };
