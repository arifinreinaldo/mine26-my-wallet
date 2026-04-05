import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import {
  handleAddTransaction,
  handleEditTransaction,
  handleDeleteTransaction,
  handleGetTransactions,
} from '../src/handlers/transactions.js';

const walletAccess = (role) => ({ match: 'SELECT w.id', result: [{ id: 1, role }] });
const noWallet = { match: 'SELECT w.id', result: [] };

describe('handleAddTransaction', () => {
  it('returns 400 for missing required fields', async () => {
    const sql = createMockSql([]);
    const result = await handleAddTransaction(sql, 1, { date: '2025-01-01' }, 1);
    expect(result.status).toBe(400);
  });

  it('returns 400 for negative amount', async () => {
    const sql = createMockSql([]);
    const result = await handleAddTransaction(sql, 1, {
      date: '2025-01-01', amount: -5, currencyCode: 'SGD',
    }, 1);
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('positive');
  });

  it('returns 400 for zero amount', async () => {
    const sql = createMockSql([]);
    const result = await handleAddTransaction(sql, 1, {
      date: '2025-01-01', amount: 0, currencyCode: 'SGD',
    }, 1);
    expect(result.status).toBe(400);
  });

  it('returns 404 for non-existent wallet', async () => {
    const sql = createMockSql([noWallet]);
    const result = await handleAddTransaction(sql, 999, {
      date: '2025-01-01', amount: 10, currencyCode: 'SGD',
    }, 1);
    expect(result.status).toBe(404);
  });

  it('returns 403 for viewers', async () => {
    const sql = createMockSql([walletAccess('viewer')]);
    const result = await handleAddTransaction(sql, 1, {
      date: '2025-01-01', amount: 10, currencyCode: 'SGD',
    }, 1);
    expect(result.status).toBe(403);
  });

  it('defaults type to expense', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      { match: 'SELECT id FROM currencies', result: [{ id: 1 }] },
      { match: 'INSERT INTO transactions', result: [{ id: 42, created_at: '2025-01-01' }] },
      { match: 'SELECT name FROM users', result: [{ name: 'John' }] },
    ]);
    const result = await handleAddTransaction(sql, 1, {
      date: '2025-01-01', amount: 10, currencyCode: 'SGD',
    }, 1);
    expect(result.body.success).toBe(true);
    expect(result.body.type).toBe('expense');
  });

  it('sets income type when specified', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      { match: 'SELECT id FROM currencies', result: [{ id: 1 }] },
      { match: 'INSERT INTO transactions', result: [{ id: 42, created_at: '2025-01-01' }] },
      { match: 'SELECT name FROM users', result: [{ name: 'John' }] },
    ]);
    const result = await handleAddTransaction(sql, 1, {
      date: '2025-01-01', amount: 100, currencyCode: 'SGD', type: 'income',
    }, 1);
    expect(result.body.type).toBe('income');
  });
});

describe('handleEditTransaction', () => {
  it('returns 403 for non-creator non-owner', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      { match: 'SELECT id, created_by_user_id', result: [{ id: 1, created_by_user_id: 99 }] },
    ]);
    const result = await handleEditTransaction(sql, 1, 1, { amount: 50 }, 2);
    expect(result.status).toBe(403);
    expect(result.body.message).toContain('own transactions');
  });

  it('returns 404 for deleted transaction', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      // deleted_at IS NULL filter means no result
    ]);
    const result = await handleEditTransaction(sql, 1, 1, { amount: 50 }, 1);
    expect(result.status).toBe(404);
  });

  it('updates and sets updated_at', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      { match: 'SELECT id, created_by_user_id', result: [{ id: 1, created_by_user_id: 1 }] },
      { match: 'UPDATE transactions', result: [{ id: 1 }] },
    ]);
    const result = await handleEditTransaction(sql, 1, 1, { amount: 50 }, 1);
    expect(result.body.success).toBe(true);
    // Verify updated_at = NOW() is in the query
    const updateCall = sql.calls.find(c => c.query.includes('UPDATE transactions'));
    expect(updateCall.query).toContain('updated_at');
  });
});

describe('handleDeleteTransaction', () => {
  it('soft-deletes with deleted_at', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      { match: 'SELECT id, created_by_user_id', result: [{ id: 1, created_by_user_id: 1 }] },
      { match: 'UPDATE transactions SET deleted_at', result: [] },
    ]);
    const result = await handleDeleteTransaction(sql, 1, 1, 1);
    expect(result.body.success).toBe(true);
    const deleteCall = sql.calls.find(c => c.query.includes('deleted_at'));
    expect(deleteCall).toBeDefined();
    // Verify it's NOT a hard DELETE
    const hardDelete = sql.calls.find(c => c.query.includes('DELETE FROM transactions'));
    expect(hardDelete).toBeUndefined();
  });

  it('returns 404 for already-deleted transaction', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      // No result because deleted_at IS NULL filter excludes it
    ]);
    const result = await handleDeleteTransaction(sql, 1, 1, 1);
    expect(result.status).toBe(404);
  });
});

describe('handleGetTransactions', () => {
  it('includes deleted_at IS NULL filter', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'FROM transactions', result: [] },
    ]);
    const params = new URLSearchParams();
    await handleGetTransactions(sql, 1, params, 1);
    const selectCall = sql.calls.find(c => c.query.includes('FROM transactions'));
    expect(selectCall.query).toContain('deleted_at IS NULL');
  });

  it('returns 400 for invalid currency code', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      { match: 'SELECT id FROM currencies', result: [] }, // currency not found
    ]);
    const result = await handleAddTransaction(sql, 1, {
      date: '2025-01-01', amount: 10, currencyCode: 'FAKE',
    }, 1);
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('Invalid currency');
  });

  it('returns correct response shape', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'FROM transactions', result: [{
        id: 1, date: '2025-01-01', description: 'Test', amount: '10.00',
        type: 'expense', currency: 'SGD', currency_symbol: 'S$',
        category: 'Food', category_id: 1, payment_method: 'Cash',
        notes: null, created_by_id: 1, created_by_name: 'John', created_at: '2025-01-01',
      }] },
    ]);
    const params = new URLSearchParams();
    const result = await handleGetTransactions(sql, 1, params, 1);
    expect(result.body.success).toBe(true);
    expect(result.body.page).toBe(1);
    expect(result.body.limit).toBe(50);
    expect(result.body.hasMore).toBe(false);
    expect(result.body.transactions).toHaveLength(1);
    expect(result.body.transactions[0].amount).toBe(10);
    expect(result.body.transactions[0].type).toBe('expense');
  });

  it('paginates with page and limit params', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1, date: '2025-01-01', description: `Tx ${i}`, amount: '10',
      type: 'expense', currency: 'SGD', currency_symbol: 'S$',
      category: null, category_id: null, payment_method: null,
      notes: null, created_by_id: 1, created_by_name: 'J', created_at: '2025-01-01',
    }));
    const sql = createMockSql([
      walletAccess('viewer'),
      // limit+1 = 3 rows returned → hasMore=true
      { match: 'FROM transactions', result: rows.slice(0, 3) },
    ]);
    const params = new URLSearchParams({ limit: '2', page: '1' });
    const result = await handleGetTransactions(sql, 1, params, 1);
    expect(result.body.page).toBe(1);
    expect(result.body.limit).toBe(2);
    expect(result.body.hasMore).toBe(true);
    expect(result.body.transactions).toHaveLength(2);
  });

  it('returns hasMore=false on last page', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      // Only 1 row (less than limit+1) → hasMore=false
      { match: 'FROM transactions', result: [{
        id: 5, date: '2025-01-05', description: 'Last', amount: '10',
        type: 'expense', currency: 'SGD', currency_symbol: 'S$',
        category: null, category_id: null, payment_method: null,
        notes: null, created_by_id: 1, created_by_name: 'J', created_at: '2025-01-05',
      }] },
    ]);
    const params = new URLSearchParams({ limit: '2', page: '3' });
    const result = await handleGetTransactions(sql, 1, params, 1);
    expect(result.body.page).toBe(3);
    expect(result.body.hasMore).toBe(false);
    expect(result.body.transactions).toHaveLength(1);
  });

  it('caps limit at 200', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'FROM transactions', result: [] },
    ]);
    const params = new URLSearchParams({ limit: '999' });
    const result = await handleGetTransactions(sql, 1, params, 1);
    expect(result.body.limit).toBe(200);
  });

  it('defaults page to 1 and limit to 50', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'FROM transactions', result: [] },
    ]);
    const params = new URLSearchParams();
    const result = await handleGetTransactions(sql, 1, params, 1);
    expect(result.body.page).toBe(1);
    expect(result.body.limit).toBe(50);
  });

  it('passes q parameter as ILIKE filter on description and notes', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'FROM transactions', result: [] },
    ]);
    const params = new URLSearchParams({ q: 'lunch' });
    await handleGetTransactions(sql, 1, params, 1);
    const selectCall = sql.calls.find(c => c.query.includes('FROM transactions'));
    expect(selectCall.query).toContain('ILIKE');
    expect(selectCall.values).toContain('lunch');
  });

  it('search combines with other filters', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'FROM transactions', result: [] },
    ]);
    const params = new URLSearchParams({ q: 'coffee', type: 'expense', from: '2025-01-01' });
    await handleGetTransactions(sql, 1, params, 1);
    const selectCall = sql.calls.find(c => c.query.includes('FROM transactions'));
    // All filters present in query
    expect(selectCall.query).toContain('ILIKE');
    expect(selectCall.query).toContain('t.type');
    expect(selectCall.query).toContain('t.date >=');
    expect(selectCall.values).toContain('coffee');
  });

  it('null q skips search filter', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'FROM transactions', result: [] },
    ]);
    const params = new URLSearchParams(); // no q param
    await handleGetTransactions(sql, 1, params, 1);
    const selectCall = sql.calls.find(c => c.query.includes('FROM transactions'));
    // ILIKE clause is in the query but q is null so it's bypassed
    expect(selectCall.query).toContain('ILIKE');
    expect(selectCall.values).toContain(null); // q is null
  });
});
