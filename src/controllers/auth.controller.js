const authService = require('../services/auth.service');
const { success, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const config = require('../config');

const COOKIE_NAME = 'refreshToken';

const setCookieOptions = () => ({
  httpOnly: config.cookie.httpOnly,
  secure: config.cookie.secure,
  sameSite: config.cookie.sameSite,
  path: config.cookie.path,
  maxAge: config.jwt.refreshMaxAgeMs,
});

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  res.cookie(COOKIE_NAME, result.refreshToken, setCookieOptions());
  return created(
    req,
    res,
    { user: result.user, accessToken: result.accessToken },
    'User registered successfully'
  );
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req.ip, req.get('user-agent'));
  res.cookie(COOKIE_NAME, result.refreshToken, setCookieOptions());
  return success(
    req,
    res,
    { user: result.user, accessToken: result.accessToken },
    'Login successful'
  );
});

const refresh = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[COOKIE_NAME];
  const result = await authService.refresh(rawToken);
  res.cookie(COOKIE_NAME, result.refreshToken, setCookieOptions());
  return success(
    req,
    res,
    { user: result.user, accessToken: result.accessToken },
    'Token refreshed'
  );
});

const logout = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[COOKIE_NAME];
  await authService.logout(rawToken);
  res.clearCookie(COOKIE_NAME, { path: config.cookie.path });
  return success(req, res, null, 'Logged out successfully');
});

const me = asyncHandler(async (req, res) => {
  const { User } = require('../models');
  const { NotFoundError } = require('../utils/apiError');
  const user = await User.findOne({ where: { id: req.user.userId } });
  if (!user) throw new NotFoundError('User not found');
  return success(req, res, user);
});

module.exports = { register, login, refresh, logout, me };
