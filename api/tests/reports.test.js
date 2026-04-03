import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import { handleGetSpendingReport } from '../src/handlers/reports.js';

const walletAccess = (role) => ({ match: 'SELECT w.id', result: [{ id: 1, role }] });

describe('handleGetSpendingReport', () => {
  it('returns 400 for invalid target currency', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'SELECT id FROM currencies', result: [] },
    ]);
    const params = new URLSearchParams({ currency: 'INVALID' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    expect(result.status).toBe(400);
  });

  it('returns 403 for non-members', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: null }] },
    ]);
    const params = new URLSearchParams();
    const result = await handleGetSpendingReport(sql, 1, params, 999);
    expect(result.status).toBe(403);
  });

  it('computes income/expense totals correctly', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'SELECT id FROM currencies', result: [{ id: 1 }] },
      { match: 'SELECT starting_balance', result: [{ starting_balance: '1000.00' }] },
      { match: 'FROM transactions', result: [
        { id: 1, date: '2025-01-15', description: 'Salary', amount: '5000.00', type: 'income', currency_code: 'SGD', currency_id: 1, category_name: null, payment_method: null, created_by_id: 1, created_by_name: 'John' },
        { id: 2, date: '2025-01-16', description: 'Rent', amount: '2000.00', type: 'expense', currency_code: 'SGD', currency_id: 1, category_name: 'Bills', payment_method: null, created_by_id: 1, created_by_name: 'John' },
      ] },
    ]);
    const params = new URLSearchParams({ currency: 'SGD' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    expect(result.body.summary.totalIncome).toBe(5000);
    expect(result.body.summary.totalExpense).toBe(2000);
    expect(result.body.summary.netCashFlow).toBe(3000);
    expect(result.body.summary.startingBalance).toBe(1000);
    expect(result.body.summary.currentBalance).toBe(4000);
  });

  it('aggregates category totals for expenses only', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      { match: 'SELECT id FROM currencies', result: [{ id: 1 }] },
      { match: 'SELECT starting_balance', result: [{ starting_balance: '0' }] },
      { match: 'FROM transactions', result: [
        { id: 1, date: '2025-01-15', description: 'Income', amount: '1000.00', type: 'income', currency_code: 'SGD', currency_id: 1, category_name: 'Salary', payment_method: null, created_by_id: 1, created_by_name: 'J' },
        { id: 2, date: '2025-01-16', description: 'Lunch', amount: '20.00', type: 'expense', currency_code: 'SGD', currency_id: 1, category_name: 'Food', payment_method: null, created_by_id: 1, created_by_name: 'J' },
      ] },
    ]);
    const params = new URLSearchParams({ currency: 'SGD' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    // Category totals should only include expenses
    expect(result.body.summary.categoryTotals).toEqual({ Food: 20 });
    // Income should not appear in category totals
    expect(result.body.summary.categoryTotals['Salary']).toBeUndefined();
  });
});
