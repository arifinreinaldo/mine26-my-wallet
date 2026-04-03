import { describe, it, expect, vi } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import { handlePushSync, handlePullSync } from '../src/handlers/sync.js';

const walletAccess = (role) => ({ match: 'SELECT w.id', result: [{ id: 1, role }] });

describe('handlePushSync', () => {
  it('returns 400 for empty changes array', async () => {
    const sql = createMockSql([walletAccess('editor')]);
    const result = await handlePushSync(sql, 1, { changes: [] }, 1);
    expect(result.status).toBe(400);
  });

  it('returns 400 for non-array changes', async () => {
    const sql = createMockSql([walletAccess('editor')]);
    const result = await handlePushSync(sql, 1, { changes: 'not-array' }, 1);
    expect(result.status).toBe(400);
  });

  it('returns 400 for batch > 500', async () => {
    const sql = createMockSql([walletAccess('editor')]);
    const changes = Array(501).fill({
      clientId: 'uuid', operation: 'create',
      data: { date: '2025-01-01', amount: 1, currencyCode: 'SGD' },
    });
    const result = await handlePushSync(sql, 1, { changes }, 1);
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('500');
  });

  it('returns 403 for viewers', async () => {
    const sql = createMockSql([walletAccess('viewer')]);
    const result = await handlePushSync(sql, 1, {
      changes: [{ clientId: 'uuid', operation: 'create', data: {} }],
    }, 1);
    expect(result.status).toBe(403);
  });

  it('returns 404 for non-existent wallet', async () => {
    const sql = createMockSql([]);
    const result = await handlePushSync(sql, 999, {
      changes: [{ clientId: 'uuid', operation: 'create', data: {} }],
    }, 1);
    expect(result.status).toBe(404);
  });

  it('rejects future timestamps (clock skew >5min)', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      { match: 'SELECT id, code FROM currencies', result: [{ id: 1, code: 'SGD' }] },
    ]);
    const futureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const result = await handlePushSync(sql, 1, {
      changes: [{
        clientId: '550e8400-e29b-41d4-a716-446655440001',
        operation: 'create',
        data: { date: '2025-01-01', amount: 10, currencyCode: 'SGD' },
        clientUpdatedAt: futureTime,
      }],
    }, 1);
    expect(result.body.errors).toHaveLength(1);
    expect(result.body.errors[0].error).toContain('future');
  });

  it('create reports error for missing required fields', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      { match: 'SELECT id, code FROM currencies', result: [] },
    ]);
    const result = await handlePushSync(sql, 1, {
      changes: [{
        clientId: '550e8400-e29b-41d4-a716-446655440001',
        operation: 'create',
        data: { description: 'no date or amount' },
        clientUpdatedAt: new Date().toISOString(),
      }],
    }, 1);
    expect(result.body.results[0].status).toBe('error');
  });

  it('create does not resurrect soft-deleted transaction', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      { match: 'SELECT id, code FROM currencies', result: [{ id: 1, code: 'SGD' }] },
      { match: 'SELECT id, deleted_at FROM transactions', result: [{ id: 42, deleted_at: '2025-01-01' }] },
    ]);
    const result = await handlePushSync(sql, 1, {
      changes: [{
        clientId: '550e8400-e29b-41d4-a716-446655440001',
        operation: 'create',
        data: { date: '2025-01-01', amount: 10, currencyCode: 'SGD' },
        clientUpdatedAt: new Date().toISOString(),
      }],
    }, 1);
    expect(result.body.results[0].status).toBe('conflict');
  });

  it('delete returns already_deleted for re-delete', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      { match: 'UPDATE transactions SET deleted_at', result: [] },
      { match: 'SELECT id FROM transactions', result: [{ id: 1 }] },
    ]);
    const result = await handlePushSync(sql, 1, {
      changes: [{
        clientId: '550e8400-e29b-41d4-a716-446655440001',
        operation: 'delete',
        clientUpdatedAt: new Date().toISOString(),
      }],
    }, 1);
    expect(result.body.results[0].status).toBe('already_deleted');
  });

  it('handles unknown operation', async () => {
    const sql = createMockSql([walletAccess('editor')]);
    const result = await handlePushSync(sql, 1, {
      changes: [{
        clientId: 'uuid',
        operation: 'invalid',
        clientUpdatedAt: new Date().toISOString(),
      }],
    }, 1);
    expect(result.body.errors).toHaveLength(1);
    expect(result.body.errors[0].error).toContain('Unknown');
  });
});

describe('handlePullSync', () => {
  it('returns changes since timestamp', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'SELECT NOW()', result: [{ now: '2025-02-01T00:00:00Z' }] },
      { match: 'FROM transactions', result: [{
        id: 1, client_id: 'uuid-1', date: '2025-01-15', description: 'Test',
        amount: '10.00', type: 'expense', currency_code: 'SGD', category_id: 1,
        category_name: 'Food', payment_method: 'Cash', notes: null,
        created_by_user_id: 1, created_by_name: 'John',
        created_at: '2025-01-15', updated_at: '2025-01-15', deleted_at: null,
      }] },
    ]);
    const params = new URLSearchParams({ since: '2025-01-01T00:00:00Z' });
    const result = await handlePullSync(sql, 1, params, 1);
    expect(result.body.success).toBe(true);
    expect(result.body.changes).toHaveLength(1);
    expect(result.body.changes[0].clientId).toBe('uuid-1');
    expect(result.body.hasMore).toBe(false);
    expect(result.body.syncTimestamp).toBeDefined();
  });

  it('returns hasMore=true when limit exceeded', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'SELECT NOW()', result: [{ now: '2025-02-01T00:00:00Z' }] },
      // Return 3 rows with limit=2 (limit+1 = 3)
      { match: 'FROM transactions', result: [
        { id: 1, client_id: 'a', date: '2025-01-01', description: '', amount: '1', type: 'expense', currency_code: 'SGD', category_id: null, category_name: null, payment_method: null, notes: null, created_by_user_id: 1, created_by_name: 'J', created_at: '2025-01-01', updated_at: '2025-01-01', deleted_at: null },
        { id: 2, client_id: 'b', date: '2025-01-02', description: '', amount: '2', type: 'expense', currency_code: 'SGD', category_id: null, category_name: null, payment_method: null, notes: null, created_by_user_id: 1, created_by_name: 'J', created_at: '2025-01-02', updated_at: '2025-01-02', deleted_at: null },
        { id: 3, client_id: 'c', date: '2025-01-03', description: '', amount: '3', type: 'expense', currency_code: 'SGD', category_id: null, category_name: null, payment_method: null, notes: null, created_by_user_id: 1, created_by_name: 'J', created_at: '2025-01-03', updated_at: '2025-01-03', deleted_at: null },
      ] },
    ]);
    const params = new URLSearchParams({ since: '2025-01-01T00:00:00Z', limit: '2' });
    const result = await handlePullSync(sql, 1, params, 1);
    expect(result.body.hasMore).toBe(true);
    expect(result.body.changes).toHaveLength(2);
    expect(result.body.syncTimestamp).toBeNull();
  });

  it('returns 403 for non-members', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: null }] },
    ]);
    const params = new URLSearchParams();
    const result = await handlePullSync(sql, 1, params, 999);
    expect(result.status).toBe(403);
  });
});
