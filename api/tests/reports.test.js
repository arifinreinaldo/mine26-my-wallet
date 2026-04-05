import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import { handleGetSpendingReport } from '../src/handlers/reports.js';

const walletAccess = (role) => ({ match: 'SELECT w.id', result: [{ id: 1, role }] });

// Helper to build a mock sql that handles the refactored parallel-query report handler.
// The handler runs 5 parallel queries after wallet+currency checks:
//   (a) income/expense totals per currency (GROUP BY currency_id, type)
//   (b) category totals per currency (GROUP BY cat.name, t.currency_id)
//   (c) monthly cash flow per currency (GROUP BY month, currency_id, type)
//   (d) user totals per currency (GROUP BY u.name, t.currency_id)
//   (e) paginated transaction list (LIMIT ... OFFSET)
// Then fetches latest rates (DISTINCT ON).
function reportSql(opts = {}) {
  return createMockSql([
    walletAccess(opts.role || 'viewer'),
    { match: 'SELECT id FROM currencies', result: [{ id: opts.targetCurId || 1 }] },
    { match: 'SELECT starting_balance', result: [{ starting_balance: opts.startingBalance || '0' }] },
    // (a) income/expense totals
    { match: 'GROUP BY currency_id, type', result: opts.incomeTotals || [] },
    // (b) category totals
    { match: 'GROUP BY cat.name', result: opts.categoryRows || [] },
    // (c) monthly cash flow
    { match: 'GROUP BY month', result: opts.monthlyRows || [] },
    // (d) user totals
    { match: 'GROUP BY u.name', result: opts.userRows || [] },
    // (e) paginated tx list
    { match: 'LIMIT', result: opts.transactions || [] },
    // latest rates
    { match: 'DISTINCT ON', result: opts.rates || [] },
  ]);
}

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

  it('computes income/expense totals from DB aggregation', async () => {
    const sql = reportSql({
      startingBalance: '1000.00',
      incomeTotals: [
        { currency_id: 1, type: 'income', total: '5000', cnt: '1' },
        { currency_id: 1, type: 'expense', total: '2000', cnt: '1' },
      ],
    });
    const params = new URLSearchParams({ currency: 'SGD' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    expect(result.body.summary.totalIncome).toBe(5000);
    expect(result.body.summary.totalExpense).toBe(2000);
    expect(result.body.summary.netCashFlow).toBe(3000);
    expect(result.body.summary.startingBalance).toBe(1000);
    expect(result.body.summary.currentBalance).toBe(4000);
    expect(result.body.summary.totalTransactions).toBe(2);
  });

  it('aggregates category totals for expenses only', async () => {
    const sql = reportSql({
      categoryRows: [
        { category: 'Food', currency_id: 1, total: '20' },
      ],
    });
    const params = new URLSearchParams({ currency: 'SGD' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    expect(result.body.summary.categoryTotals).toEqual({ Food: 20 });
    expect(result.body.summary.categoryTotals['Salary']).toBeUndefined();
  });

  it('groups null category as Uncategorized', async () => {
    const sql = reportSql({
      categoryRows: [
        { category: 'Uncategorized', currency_id: 1, total: '50' },
      ],
    });
    const params = new URLSearchParams({ currency: 'SGD' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    expect(result.body.summary.categoryTotals['Uncategorized']).toBe(50);
  });

  it('generates monthly cash flow by month', async () => {
    const sql = reportSql({
      monthlyRows: [
        { month: '2025-01', currency_id: 1, type: 'income', total: '5000' },
        { month: '2025-01', currency_id: 1, type: 'expense', total: '2000' },
        { month: '2025-02', currency_id: 1, type: 'income', total: '5000' },
      ],
    });
    const params = new URLSearchParams({ currency: 'SGD' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    expect(result.body.summary.monthlyCashFlow['2025-01']).toEqual({ income: 5000, expense: 2000 });
    expect(result.body.summary.monthlyCashFlow['2025-02']).toEqual({ income: 5000, expense: 0 });
  });

  it('includes pagination metadata in response', async () => {
    const sql = reportSql();
    const params = new URLSearchParams({ currency: 'SGD' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    expect(result.body.page).toBe(1);
    expect(result.body.limit).toBe(50);
    expect(result.body.hasMore).toBe(false);
  });

  it('paginates transaction list with LIMIT+1 trick', async () => {
    // 3 rows returned when limit=2 → hasMore=true, only 2 in response
    const txRows = [
      { id: 1, date: '2025-01-01', description: 'A', amount: '10', type: 'expense', currency_code: 'SGD', currency_id: 1, category_name: 'Food', payment_method: null, created_by_id: 1, created_by_name: 'J' },
      { id: 2, date: '2025-01-02', description: 'B', amount: '20', type: 'expense', currency_code: 'SGD', currency_id: 1, category_name: 'Food', payment_method: null, created_by_id: 1, created_by_name: 'J' },
      { id: 3, date: '2025-01-03', description: 'C', amount: '30', type: 'expense', currency_code: 'SGD', currency_id: 1, category_name: 'Food', payment_method: null, created_by_id: 1, created_by_name: 'J' },
    ];
    const sql = reportSql({ transactions: txRows });
    const params = new URLSearchParams({ currency: 'SGD', limit: '2', page: '1' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    expect(result.body.hasMore).toBe(true);
    expect(result.body.transactions).toHaveLength(2);
    expect(result.body.page).toBe(1);
    expect(result.body.limit).toBe(2);
  });

  it('converts multi-currency summary using latest rates', async () => {
    const sql = reportSql({
      targetCurId: 1,
      incomeTotals: [
        { currency_id: 1, type: 'expense', total: '100', cnt: '1' },
        { currency_id: 2, type: 'expense', total: '10000', cnt: '1' }, // 10000 IDR
      ],
      rates: [
        { from_currency_id: 2, to_currency_id: 1, rate: '0.0001' }, // IDR→SGD
      ],
    });
    const params = new URLSearchParams({ currency: 'SGD' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    // 100 SGD + 10000 IDR * 0.0001 = 100 + 1 = 101
    expect(result.body.summary.totalExpense).toBe(101);
  });

  it('user totals aggregate across currencies', async () => {
    const sql = reportSql({
      userRows: [
        { name: 'Alice', currency_id: 1, total: '500' },
        { name: 'Alice', currency_id: 2, total: '10000' },
        { name: 'Bob', currency_id: 1, total: '200' },
      ],
      rates: [
        { from_currency_id: 2, to_currency_id: 1, rate: '0.01' },
      ],
    });
    const params = new URLSearchParams({ currency: 'SGD' });
    const result = await handleGetSpendingReport(sql, 1, params, 1);
    // Alice: 500 + 10000*0.01 = 600
    expect(result.body.summary.userTotals['Alice']).toBe(600);
    expect(result.body.summary.userTotals['Bob']).toBe(200);
  });
});
