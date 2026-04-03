import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import {
  checkWalletAccess,
  handleCreateWallet,
  handleEditWallet,
  handleDeleteWallet,
  handleGetWalletMembers,
  handleAddWalletMember,
  handleRemoveWalletMember,
} from '../src/handlers/wallets.js';

describe('checkWalletAccess', () => {
  it('returns exists=false for missing wallet', async () => {
    const sql = createMockSql([]);
    const result = await checkWalletAccess(sql, 999, 1);
    expect(result).toEqual({ exists: false, role: null });
  });

  it('returns role=null for non-member', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: null }] },
    ]);
    const result = await checkWalletAccess(sql, 1, 999);
    expect(result).toEqual({ exists: true, role: null });
  });

  it('returns correct role for member', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'owner' }] },
    ]);
    const result = await checkWalletAccess(sql, 1, 1);
    expect(result).toEqual({ exists: true, role: 'owner' });
  });
});

describe('handleCreateWallet', () => {
  it('returns 400 for missing name', async () => {
    const sql = createMockSql([]);
    const result = await handleCreateWallet(sql, { description: 'test' }, 1);
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
  });

  it('creates wallet with starting balance and owner', async () => {
    const sql = createMockSql([
      { match: 'INSERT INTO wallets', result: [{ id: 1, name: 'Test', created_at: '2025-01-01' }] },
      { match: 'INSERT INTO wallet_users', result: [] },
    ]);
    const result = await handleCreateWallet(sql, { name: 'Test', startingBalance: 500 }, 1);
    expect(result.body.success).toBe(true);
    expect(result.body.wallet.startingBalance).toBe(500);
    // Verify owner role insert was called
    const ownerCall = sql.calls.find(c => c.query.includes('INSERT INTO wallet_users'));
    expect(ownerCall).toBeDefined();
  });
});

describe('handleEditWallet', () => {
  it('returns 404 for non-existent wallet', async () => {
    const sql = createMockSql([]);
    const result = await handleEditWallet(sql, 999, { name: 'New' }, 1);
    expect(result.status).toBe(404);
  });

  it('returns 403 for non-owner', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'editor' }] },
    ]);
    const result = await handleEditWallet(sql, 1, { name: 'New' }, 2);
    expect(result.status).toBe(403);
  });

  it('updates wallet for owner', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'owner' }] },
      { match: 'UPDATE wallets', result: [{ id: 1, name: 'Updated' }] },
    ]);
    const result = await handleEditWallet(sql, 1, { name: 'Updated' }, 1);
    expect(result.body.success).toBe(true);
    expect(result.body.wallet.name).toBe('Updated');
  });
});

describe('handleDeleteWallet', () => {
  it('returns 403 for non-owner', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'viewer' }] },
    ]);
    const result = await handleDeleteWallet(sql, 1, 2);
    expect(result.status).toBe(403);
  });
});

describe('handleAddWalletMember', () => {
  it('returns 400 for missing userId', async () => {
    const sql = createMockSql([]);
    const result = await handleAddWalletMember(sql, 1, { role: 'editor' }, 1);
    expect(result.status).toBe(400);
  });

  it('returns 403 when editor tries to assign owner role', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'editor' }] },
    ]);
    const result = await handleAddWalletMember(sql, 1, { userId: 2, role: 'owner' }, 1);
    expect(result.status).toBe(403);
    expect(result.body.message).toContain('owner');
  });

  it('returns 409 when user is already a member', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'owner' }] },
      { match: 'SELECT id, name FROM users', result: [{ id: 2, name: 'Jane' }] },
      { match: 'SELECT id FROM wallet_users', result: [{ id: 1 }] },
    ]);
    const result = await handleAddWalletMember(sql, 1, { userId: 2, role: 'editor' }, 1);
    expect(result.status).toBe(409);
  });
});

describe('handleRemoveWalletMember', () => {
  it('returns 400 when removing last owner', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'owner' }] },
      { match: 'SELECT role FROM wallet_users', result: [{ role: 'owner' }] },
      { match: 'SELECT COUNT', result: [{ count: '1' }] },
    ]);
    const result = await handleRemoveWalletMember(sql, 1, 1, 1);
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('last owner');
  });
});

describe('handleGetWalletMembers', () => {
  it('returns 403 for non-members', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: null }] },
    ]);
    const result = await handleGetWalletMembers(sql, 1, 999);
    expect(result.status).toBe(403);
  });
});
