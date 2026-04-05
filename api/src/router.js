import {
  handleFetchRates,
  handleGetRecommendations,
  handleApplyRate,
  handleManualRate,
  handleGetCurrentRate,
} from './handlers/rates.js';

import {
  handleGetMe,
  handleSearchUser,
} from './handlers/users.js';

import {
  handleCreateWallet,
  handleGetWallets,
  handleEditWallet,
  handleDeleteWallet,
  handleGetWalletMembers,
  handleAddWalletMember,
  handleRemoveWalletMember,
} from './handlers/wallets.js';

import {
  handleAddTransaction,
  handleEditTransaction,
  handleDeleteTransaction,
  handleGetTransactions,
} from './handlers/transactions.js';

import { handleGetSpendingReport } from './handlers/reports.js';
import { handleGetDashboard } from './handlers/dashboard.js';

import {
  handleGetCategories,
  handleCreateCategory,
  handleEditCategory,
  handleDeleteCategory,
} from './handlers/categories.js';

import {
  handleCreateRecurring,
  handleGetRecurring,
  handleDeleteRecurring,
} from './handlers/recurring.js';

import { handleExportCsv } from './handlers/export.js';
import { handleImport } from './handlers/import.js';

import {
  handlePushSync,
  handlePullSync,
} from './handlers/sync.js';

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
export function matchPath(pattern, pathname) {
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
  { method: 'GET', path: '/api/users/me', handler: (sql, _p, _u, _b, _e, user) => handleGetMe(sql, user.userId) },
  { method: 'GET', path: '/api/users/search', handler: (sql, _p, url) => handleSearchUser(sql, url.searchParams.get('username')) },

  // Categories
  { method: 'GET', path: '/api/categories', handler: (sql, _p, url, _b, _e, user) => handleGetCategories(sql, url.searchParams, user.userId) },
  { method: 'POST', path: '/api/categories', handler: (sql, _p, _u, body, _e, user) => handleCreateCategory(sql, body, user.userId) },
  { method: 'PUT', path: '/api/categories/:categoryId', handler: (sql, params, _u, body, _e, user) => handleEditCategory(sql, params.categoryId, body, user.userId) },
  { method: 'DELETE', path: '/api/categories/:categoryId', handler: (sql, params, _u, _b, _e, user) => handleDeleteCategory(sql, params.categoryId, user.userId) },

  // Wallets
  { method: 'POST', path: '/api/wallets', handler: (sql, _p, _u, body, _e, user) => handleCreateWallet(sql, body, user.userId) },
  { method: 'GET', path: '/api/wallets', handler: (sql, _p, _u, _b, _e, user) => handleGetWallets(sql, user.userId) },
  { method: 'PUT', path: '/api/wallets/:walletId', handler: (sql, params, _u, body, _e, user) => handleEditWallet(sql, params.walletId, body, user.userId) },
  { method: 'DELETE', path: '/api/wallets/:walletId', handler: (sql, params, _u, _b, _e, user) => handleDeleteWallet(sql, params.walletId, user.userId) },
  { method: 'GET', path: '/api/wallets/:walletId/members', handler: (sql, params, _u, _b, _e, user) => handleGetWalletMembers(sql, params.walletId, user.userId) },
  { method: 'POST', path: '/api/wallets/:walletId/members', handler: (sql, params, _u, body, _e, user) => handleAddWalletMember(sql, params.walletId, body, user.userId) },
  { method: 'DELETE', path: '/api/wallets/:walletId/members/:userId', handler: (sql, params, _u, _b, _e, user) => handleRemoveWalletMember(sql, params.walletId, params.userId, user.userId) },

  // Transactions (wallet-scoped)
  { method: 'POST', path: '/api/wallets/:walletId/transactions', handler: (sql, params, _u, body, _e, user) => handleAddTransaction(sql, params.walletId, body, user.userId) },
  { method: 'GET', path: '/api/wallets/:walletId/transactions', handler: (sql, params, url, _b, _e, user) => handleGetTransactions(sql, params.walletId, url.searchParams, user.userId) },
  { method: 'PUT', path: '/api/wallets/:walletId/transactions/:transactionId', handler: (sql, params, _u, body, _e, user) => handleEditTransaction(sql, params.walletId, params.transactionId, body, user.userId) },
  { method: 'DELETE', path: '/api/wallets/:walletId/transactions/:transactionId', handler: (sql, params, _u, _b, _e, user) => handleDeleteTransaction(sql, params.walletId, params.transactionId, user.userId) },

  // Recurring transactions (wallet-scoped)
  { method: 'POST', path: '/api/wallets/:walletId/recurring', handler: (sql, params, _u, body, _e, user) => handleCreateRecurring(sql, params.walletId, body, user.userId) },
  { method: 'GET', path: '/api/wallets/:walletId/recurring', handler: (sql, params, _u, _b, _e, user) => handleGetRecurring(sql, params.walletId, user.userId) },
  { method: 'DELETE', path: '/api/wallets/:walletId/recurring/:recurringId', handler: (sql, params, _u, _b, _e, user) => handleDeleteRecurring(sql, params.walletId, params.recurringId, user.userId) },

  // Reports (wallet-scoped)
  { method: 'GET', path: '/api/wallets/:walletId/reports/spending', handler: (sql, params, url, _b, _e, user) => handleGetSpendingReport(sql, params.walletId, url.searchParams, user.userId) },

  // Dashboard (wallet-scoped)
  { method: 'GET', path: '/api/wallets/:walletId/dashboard', handler: (sql, params, _u, _b, _e, user) => handleGetDashboard(sql, params.walletId, user.userId) },

  // Export (wallet-scoped)
  { method: 'GET', path: '/api/wallets/:walletId/export/csv', handler: (sql, params, url, _b, _e, user) => handleExportCsv(sql, params.walletId, url.searchParams, user.userId) },

  // Import (wallet-scoped)
  { method: 'POST', path: '/api/wallets/:walletId/import', handler: (sql, params, _u, body, _e, user) => handleImport(sql, params.walletId, body, user.userId) },

  // Sync (wallet-scoped)
  { method: 'POST', path: '/api/wallets/:walletId/sync', handler: (sql, params, _u, body, _e, user) => handlePushSync(sql, params.walletId, body, user.userId) },
  { method: 'GET', path: '/api/wallets/:walletId/sync', handler: (sql, params, url, _b, _e, user) => handlePullSync(sql, params.walletId, url.searchParams, user.userId) },
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
    return await route.handler(sql, params, url, body, env, payload);
  }

  return null;
}
