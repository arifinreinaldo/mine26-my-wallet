import {
  handleFetchRates,
  handleGetRecommendations,
  handleApplyRate,
  handleManualRate,
  handleGetCurrentRate,
} from './handlers/rates.js';

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

const routes = [
  // Exchange rates
  { method: 'POST', path: '/api/rates/fetch', handler: (sql) => handleFetchRates(sql) },
  { method: 'GET', path: '/api/rates/recommendations', handler: (sql) => handleGetRecommendations(sql) },
  { method: 'GET', path: '/api/rates/current', handler: (sql, _p, url) => handleGetCurrentRate(sql, url.searchParams.get('from'), url.searchParams.get('to')) },
  { method: 'POST', path: '/api/rates/manual', handler: (sql, _p, _u, body) => handleManualRate(sql, body) },
  { method: 'POST', path: '/api/rates/apply', handler: (sql, _p, _u, body) => handleApplyRate(sql, body) },

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

export async function handleRoute(sql, method, url, request) {
  const pathname = url.pathname;

  for (const route of routes) {
    if (route.method !== method) continue;

    const params = matchPath(route.path, pathname);
    if (params === null) continue;

    let body = null;
    if (method === 'POST' || method === 'PUT') {
      body = await request.json().catch(() => ({}));
    }

    const result = await route.handler(sql, params, url, body);
    return result;
  }

  return null;
}
