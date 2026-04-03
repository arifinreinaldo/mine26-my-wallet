import { describe, it, expect } from 'vitest';
import { matchPath } from '../src/router.js';

describe('matchPath', () => {
  it('matches exact path', () => {
    const result = matchPath('/api/wallets', '/api/wallets');
    expect(result).toEqual({});
  });

  it('extracts single :param placeholder', () => {
    const result = matchPath('/api/wallets/:walletId', '/api/wallets/42');
    expect(result).toEqual({ walletId: '42' });
  });

  it('extracts multiple :param placeholders', () => {
    const result = matchPath(
      '/api/wallets/:walletId/transactions/:transactionId',
      '/api/wallets/1/transactions/99'
    );
    expect(result).toEqual({ walletId: '1', transactionId: '99' });
  });

  it('returns null for different segment count', () => {
    const result = matchPath('/api/wallets/:walletId', '/api/wallets/1/members');
    expect(result).toBeNull();
  });

  it('returns null for non-matching literal segment', () => {
    const result = matchPath('/api/wallets/:walletId', '/api/users/1');
    expect(result).toBeNull();
  });
});
