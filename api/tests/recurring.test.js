import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import {
  handleCreateRecurring,
  handleGetRecurring,
  handleDeleteRecurring,
  processRecurringTransactions,
  calculateNextDueDate,
} from '../src/handlers/recurring.js';

describe('handleCreateRecurring', () => {
  it('returns 400 for missing required fields', async () => {
    const sql = createMockSql([]);
    const result = await handleCreateRecurring(sql, 1, { amount: 100 }, 1);
    expect(result.status).toBe(400);
  });

  it('returns 400 for invalid frequency', async () => {
    const sql = createMockSql([]);
    const result = await handleCreateRecurring(sql, 1, {
      amount: 100, currencyCode: 'SGD', frequency: 'hourly', startDate: '2025-01-01',
    }, 1);
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('frequency');
  });

  it('returns 400 for non-positive amount', async () => {
    const sql = createMockSql([]);
    const result = await handleCreateRecurring(sql, 1, {
      amount: -10, currencyCode: 'SGD', frequency: 'monthly', startDate: '2025-01-01',
    }, 1);
    expect(result.status).toBe(400);
  });
});

describe('handleDeleteRecurring', () => {
  it('deactivates instead of hard delete', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'owner' }] },
      { match: 'SELECT id, created_by_user_id FROM recurring', result: [{ id: 1, created_by_user_id: 1 }] },
      { match: 'UPDATE recurring_transactions SET is_active', result: [] },
    ]);
    const result = await handleDeleteRecurring(sql, 1, 1, 1);
    expect(result.body.success).toBe(true);
    expect(result.body.message).toContain('deactivated');
    // Verify no hard DELETE
    const hardDelete = sql.calls.find(c => c.query.includes('DELETE FROM'));
    expect(hardDelete).toBeUndefined();
  });
});

describe('handleGetRecurring', () => {
  it('returns 404 for non-existent wallet', async () => {
    const sql = createMockSql([]);
    const result = await handleGetRecurring(sql, 999, 1);
    expect(result.status).toBe(404);
  });

  it('returns 403 for non-members', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: null }] },
    ]);
    const result = await handleGetRecurring(sql, 1, 999);
    expect(result.status).toBe(403);
  });

  it('returns recurring transactions list', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'viewer' }] },
      { match: 'FROM recurring_transactions', result: [{
        id: 1, description: 'Rent', amount: '2000.00', type: 'expense',
        frequency: 'monthly', currency: 'SGD', category_id: 1, category_name: 'Bills',
        payment_method: 'Transfer', notes: null,
        start_date: '2025-01-01', end_date: null, next_due_date: '2025-02-01',
        is_active: true, created_by_id: 1, created_by_name: 'John',
        created_at: '2025-01-01',
      }] },
    ]);
    const result = await handleGetRecurring(sql, 1, 1);
    expect(result.body.success).toBe(true);
    expect(result.body.recurringTransactions).toHaveLength(1);
    expect(result.body.recurringTransactions[0].amount).toBe(2000);
    expect(result.body.recurringTransactions[0].frequency).toBe('monthly');
  });
});

describe('processRecurringTransactions', () => {
  it('processes due entries and creates transactions', async () => {
    const sql = createMockSql([
      { match: 'FROM recurring_transactions', result: [{
        id: 1, wallet_id: 1, next_due_date: '2025-01-01', description: 'Rent',
        amount: '2000', type: 'expense', currency_id: 1, category_id: 1,
        payment_method: 'Transfer', notes: null, created_by_user_id: 1,
        frequency: 'monthly', end_date: null,
      }] },
      { match: 'INSERT INTO transactions', result: [] },
      { match: 'UPDATE recurring_transactions', result: [] },
    ]);

    const count = await processRecurringTransactions(sql);
    expect(count).toBe(1);
    expect(sql.callsTo('INSERT INTO transactions')).toHaveLength(1);
    expect(sql.callsTo('UPDATE recurring_transactions')).toHaveLength(1);
  });

  it('returns 0 when no entries are due', async () => {
    const sql = createMockSql([
      { match: 'FROM recurring_transactions', result: [] },
    ]);
    const count = await processRecurringTransactions(sql);
    expect(count).toBe(0);
  });
});

describe('calculateNextDueDate', () => {
  it('daily: adds 1 day', () => {
    expect(calculateNextDueDate('2025-01-15', 'daily')).toBe('2025-01-16');
  });

  it('weekly: adds 7 days', () => {
    expect(calculateNextDueDate('2025-01-15', 'weekly')).toBe('2025-01-22');
  });

  it('biweekly: adds 14 days', () => {
    expect(calculateNextDueDate('2025-01-15', 'biweekly')).toBe('2025-01-29');
  });

  it('monthly: Jan 31 → Feb 28 (not Mar 3)', () => {
    expect(calculateNextDueDate('2025-01-31', 'monthly')).toBe('2025-02-28');
  });

  it('monthly: Jan 28 → Feb 28 (normal)', () => {
    expect(calculateNextDueDate('2025-01-28', 'monthly')).toBe('2025-02-28');
  });

  it('yearly: Feb 29 → Feb 28 in non-leap year', () => {
    // 2024 is leap, 2025 is not
    expect(calculateNextDueDate('2024-02-29', 'yearly')).toBe('2025-02-28');
  });

  it('yearly: normal date', () => {
    expect(calculateNextDueDate('2025-03-15', 'yearly')).toBe('2026-03-15');
  });
});
