import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import { handleGetMe, handleSearchUser } from '../src/handlers/users.js';

describe('handleGetMe', () => {
  it('returns 404 for non-existent user', async () => {
    const sql = createMockSql([]);
    const result = await handleGetMe(sql, 999);
    expect(result.status).toBe(404);
  });

  it('returns user profile with wallets', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, name, email', result: [{
        id: 1, name: 'John', email: 'john@test.com', username: 'john', created_at: '2025-01-01',
      }] },
      { match: 'FROM wallet_users', result: [
        { id: 1, name: 'My Wallet', description: 'Personal', role: 'owner', joined_at: '2025-01-01' },
        { id: 2, name: 'Shared', description: null, role: 'editor', joined_at: '2025-01-02' },
      ] },
    ]);

    const result = await handleGetMe(sql, 1);
    expect(result.body.success).toBe(true);
    expect(result.body.user.username).toBe('john');
    expect(result.body.user.wallets).toHaveLength(2);
    expect(result.body.user.wallets[0].role).toBe('owner');
    expect(result.body.user.wallets[1].role).toBe('editor');
  });

  it('returns user with empty wallets array', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, name, email', result: [{
        id: 1, name: 'John', email: 'john@test.com', username: 'john', created_at: '2025-01-01',
      }] },
      { match: 'FROM wallet_users', result: [] },
    ]);

    const result = await handleGetMe(sql, 1);
    expect(result.body.user.wallets).toEqual([]);
  });
});

describe('handleSearchUser', () => {
  it('returns 400 for missing username', async () => {
    const sql = createMockSql([]);
    const result = await handleSearchUser(sql, null);
    expect(result.status).toBe(400);
  });

  it('returns 404 for non-existent or unverified user', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, name, username', result: [] },
    ]);
    const result = await handleSearchUser(sql, 'nobody');
    expect(result.status).toBe(404);
  });

  it('returns user for verified match', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, name, username', result: [{ id: 1, name: 'John', username: 'john' }] },
    ]);
    const result = await handleSearchUser(sql, 'john');
    expect(result.body.success).toBe(true);
    expect(result.body.user.id).toBe(1);
    expect(result.body.user.username).toBe('john');
  });
});
