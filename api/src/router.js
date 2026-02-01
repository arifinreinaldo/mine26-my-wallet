import {
  handleFetchRates,
  handleGetRecommendations,
  handleApplyRate,
  handleManualRate,
  handleGetCurrentRate,
} from './handlers/rates.js';

import {
  handleGetUsers,
  handleGetUser,
} from './handlers/users.js';

import {
  handleCreateWallet,
  handleGetWallets,
  handleGetWalletMembers,
  handleAddWalletMember,
  handleRemoveWalletMember,
} from './handlers/wallets.js';

import {
  handleAddTransaction,
  handleGetTransactions,
} from './handlers/transactions.js';

import { handleGetSpendingReport } from './handlers/reports.js';

import {
  handleCheckUsername,
  handleRegister,
  handleVerifyRegistration,
  handleLogin,
  handleVerifyLogin,
} from './handlers/auth.js';

import { verifyJwt } from './helpers/jwt.js';

/**
 * Match a URL path against a pattern with :param placeholders.
 * Returns an object of params if matched, or null.
 */
function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// Auth routes (public, no JWT required)
const authRoutes = [
  { method: 'GET', path: '/api/auth/check-username', handler: (sql, _p, url) => handleCheckUsername(sql, url.searchParams.get('username')) },
  { method: 'POST', path: '/api/auth/register', handler: (sql, _p, _u, body) => handleRegister(sql, body) },
  { method: 'POST', path: '/api/auth/verify-registration', handler: (sql, _p, _u, body, env) => handleVerifyRegistration(sql, body, env) },
  { method: 'POST', path: '/api/auth/login', handler: (sql, _p, _u, body) => handleLogin(sql, body) },
  { method: 'POST', path: '/api/auth/verify-login', handler: (sql, _p, _u, body, env) => handleVerifyLogin(sql, body, env) },
];

// Protected routes (JWT required)
const protectedRoutes = [
  // Exchange rates
  { method: 'POST', path: '/api/rates/fetch', handler: (sql) => handleFetchRates(sql) },
  { method: 'GET', path: '/api/rates/recommendations', handler: (sql) => handleGetRecommendations(sql) },
  { method: 'GET', path: '/api/rates/current', handler: (sql, _p, url) => handleGetCurrentRate(sql, url.searchParams.get('from'), url.searchParams.get('to')) },
  { method: 'POST', path: '/api/rates/manual', handler: (sql, _p, _u, body) => handleManualRate(sql, body) },
  { method: 'POST', path: '/api/rates/apply', handler: (sql, _p, _u, body) => handleApplyRate(sql, body) },

  // Users
  { method: 'GET', path: '/api/users', handler: (sql) => handleGetUsers(sql) },
  { method: 'GET', path: '/api/users/:userId', handler: (sql, params) => handleGetUser(sql, params.userId) },

  // Wallets
  { method: 'POST', path: '/api/wallets', handler: (sql, _p, _u, body) => handleCreateWallet(sql, body) },
  { method: 'GET', path: '/api/wallets', handler: (sql, _p, url) => handleGetWallets(sql, url.searchParams.get('userId')) },
  { method: 'GET', path: '/api/wallets/:walletId/members', handler: (sql, params) => handleGetWalletMembers(sql, params.walletId) },
  { method: 'POST', path: '/api/wallets/:walletId/members', handler: (sql, params, _u, body) => handleAddWalletMember(sql, params.walletId, body) },
  { method: 'DELETE', path: '/api/wallets/:walletId/members/:userId', handler: (sql, params) => handleRemoveWalletMember(sql, params.walletId, params.userId) },

  // Transactions (wallet-scoped)
  { method: 'POST', path: '/api/wallets/:walletId/transactions', handler: (sql, params, _u, body) => handleAddTransaction(sql, params.walletId, body) },
  { method: 'GET', path: '/api/wallets/:walletId/transactions', handler: (sql, params, url) => handleGetTransactions(sql, params.walletId, url.searchParams) },

  // Reports (wallet-scoped)
  { method: 'GET', path: '/api/wallets/:walletId/reports/spending', handler: (sql, params, url) => handleGetSpendingReport(sql, params.walletId, url.searchParams) },
];

export async function handleRoute(sql, method, url, request, env) {
  const pathname = url.pathname;

  // Try auth routes first (public)
  for (const route of authRoutes) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, pathname);
    if (params === null) continue;

    let body = null;
    if (method === 'POST' || method === 'PUT') {
      body = await request.json().catch(() => ({}));
    }
    return await route.handler(sql, params, url, body, env);
  }

  // Protected routes require JWT
  for (const route of protectedRoutes) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, pathname);
    if (params === null) continue;

    // Verify JWT
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { status: 401, body: { success: false, message: 'Missing or invalid Authorization header' } };
    }

    const token = authHeader.slice(7);
    const payload = await verifyJwt(token, env.JWT_SECRET);
    if (!payload) {
      return { status: 401, body: { success: false, message: 'Invalid or expired token' } };
    }

    let body = null;
    if (method === 'POST' || method === 'PUT') {
      body = await request.json().catch(() => ({}));
    }
    return await route.handler(sql, params, url, body, env);
  }

  return null;
}
