import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import {
  handleCreateRecurring,
  handleDeleteRecurring,
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
