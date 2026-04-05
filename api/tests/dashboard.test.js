import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import { handleGetDashboard } from '../src/handlers/dashboard.js';

function walletAccess(role) {
  return { match: 'SELECT w.id', result: [{ id: 1, role }] };
}

function walletMeta(opts = {}) {
  return {
    match: 'SELECT w.starting_balance',
    result: [{
      starting_balance: opts.startingBalance || '0',
      default_currency_id: opts.defCurId || 1,
      default_currency: opts.defCur || 'SGD',
      default_currency_symbol: opts.defSym || 'S$',
    }],
  };
}

describe('handleGetDashboard', () => {
  it('returns 404 for non-existent wallet', async () => {
    const sql = createMockSql([]);
    const result = await handleGetDashboard(sql, 999, 1);
    expect(result.status).toBe(404);
  });

  it('returns 403 for non-members', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: null }] },
    ]);
    const result = await handleGetDashboard(sql, 1, 999);
    expect(result.status).toBe(403);
  });

  it('viewers can access dashboard', async () => {
    const sql = createMockSql([
      walletAccess('viewer'),
      walletMeta(),
      // period totals, category totals, recent tx, rates — all empty
    ]);
    const result = await handleGetDashboard(sql, 1, 1);
    expect(result.body.success).toBe(true);
  });

  it('returns correct response shape with empty wallet', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ startingBalance: '5000', defCur: 'SGD', defSym: 'S$' }),
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    const b = result.body;

    expect(b.success).toBe(true);
    expect(b.walletId).toBe(1);
    expect(b.defaultCurrency).toBe('SGD');
    expect(b.defaultCurrencySymbol).toBe('S$');
    expect(b.today.spending).toBe(0);
    expect(b.thisWeek.spending).toBe(0);
    expect(b.thisMonth).toEqual({ spending: 0, income: 0, net: 0 });
    expect(b.topCategories).toEqual([]);
    expect(b.recentTransactions).toEqual([]);
    expect(b.currentBalance).toBe(5000);
  });

  it('aggregates period totals in default currency', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ startingBalance: '1000', defCurId: 1 }),
      // period totals — single currency, same as default
      { match: 'GROUP BY currency_id', result: [{
        currency_id: 1,
        today_expense: '50.00',
        week_expense: '200.00',
        month_expense: '800.00',
        month_income: '3000.00',
        all_time_net: '5000.00',
      }] },
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    expect(result.body.today.spending).toBe(50);
    expect(result.body.thisWeek.spending).toBe(200);
    expect(result.body.thisMonth.spending).toBe(800);
    expect(result.body.thisMonth.income).toBe(3000);
    expect(result.body.thisMonth.net).toBe(2200);
    expect(result.body.currentBalance).toBe(6000); // 1000 + 5000
  });

  it('converts multi-currency period totals using latest rates', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ startingBalance: '0', defCurId: 1 }),
      // period totals — two currencies
      { match: 'GROUP BY currency_id', result: [
        { currency_id: 1, today_expense: '10', week_expense: '10', month_expense: '10', month_income: '0', all_time_net: '-10' },
        { currency_id: 2, today_expense: '100', week_expense: '100', month_expense: '100', month_income: '0', all_time_net: '-100' },
      ] },
      // category totals — empty
      // recent tx — empty
      // rates: currency 2 → default 1, rate = 0.01 (e.g. IDR to SGD)
      { match: 'FROM exchange_rates', result: [
        { from_currency_id: 2, to_currency_id: 1, rate: '0.01' },
      ] },
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    // 10 SGD + 100 IDR * 0.01 = 10 + 1 = 11
    expect(result.body.today.spending).toBe(11);
    expect(result.body.thisWeek.spending).toBe(11);
    expect(result.body.thisMonth.spending).toBe(11);
  });

  it('handles inverse rate direction', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ startingBalance: '0', defCurId: 1 }),
      { match: 'GROUP BY currency_id', result: [
        { currency_id: 2, today_expense: '100', week_expense: '100', month_expense: '100', month_income: '0', all_time_net: '-100' },
      ] },
      // rate stored as default(1) → other(2) = 100, so other→default = 1/100
      { match: 'FROM exchange_rates', result: [
        { from_currency_id: 1, to_currency_id: 2, rate: '100' },
      ] },
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    // 100 * (1/100) = 1
    expect(result.body.today.spending).toBe(1);
  });

  it('returns top 5 categories sorted by total', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ defCurId: 1 }),
      { match: 'GROUP BY currency_id', result: [] },
      // 6 categories — should return only top 5
      { match: 'GROUP BY cat.id', result: [
        { category_id: 1, category_name: 'Food', icon: 'utensils', currency_id: 1, total: '500' },
        { category_id: 2, category_name: 'Transport', icon: 'car', currency_id: 1, total: '200' },
        { category_id: 3, category_name: 'Shopping', icon: 'bag', currency_id: 1, total: '150' },
        { category_id: 4, category_name: 'Bills', icon: 'file', currency_id: 1, total: '100' },
        { category_id: 5, category_name: 'Healthcare', icon: 'heart', currency_id: 1, total: '80' },
        { category_id: 6, category_name: 'Others', icon: null, currency_id: 1, total: '30' },
      ] },
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    expect(result.body.topCategories).toHaveLength(5);
    expect(result.body.topCategories[0].name).toBe('Food');
    expect(result.body.topCategories[0].total).toBe(500);
    expect(result.body.topCategories[4].name).toBe('Healthcare');
    // 6th category excluded
    expect(result.body.topCategories.find(c => c.name === 'Others')).toBeUndefined();
  });

  it('groups null category as Uncategorized in top categories', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ defCurId: 1 }),
      { match: 'GROUP BY currency_id', result: [] },
      { match: 'GROUP BY cat.id', result: [
        { category_id: null, category_name: 'Uncategorized', icon: null, currency_id: 1, total: '100' },
      ] },
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    expect(result.body.topCategories[0].name).toBe('Uncategorized');
    expect(result.body.topCategories[0].total).toBe(100);
  });

  it('aggregates same category across currencies in top categories', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ defCurId: 1 }),
      { match: 'GROUP BY currency_id', result: [] },
      // Same category, two currencies
      { match: 'GROUP BY cat.id', result: [
        { category_id: 1, category_name: 'Food', icon: 'utensils', currency_id: 1, total: '100' },
        { category_id: 1, category_name: 'Food', icon: 'utensils', currency_id: 2, total: '5000' },
      ] },
      // rate: currency 2 → 1 = 0.01
      { match: 'FROM exchange_rates', result: [
        { from_currency_id: 2, to_currency_id: 1, rate: '0.01' },
      ] },
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    expect(result.body.topCategories).toHaveLength(1);
    // 100 + 5000*0.01 = 150
    expect(result.body.topCategories[0].total).toBe(150);
  });

  it('formats recent transactions with converted amounts', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ defCurId: 1 }),
      { match: 'GROUP BY currency_id', result: [] },
      { match: 'GROUP BY cat.id', result: [] },
      // recent transactions
      { match: 'LIMIT 10', result: [{
        id: 42, date: '2026-04-05', description: 'Lunch', amount: '15000',
        type: 'expense', currency_id: 2, currency: 'IDR', currency_symbol: 'Rp',
        category: 'Food', payment_method: 'Cash',
        created_by_id: 1, created_by_name: 'John', created_at: '2026-04-05T12:00:00Z',
      }] },
      { match: 'FROM exchange_rates', result: [
        { from_currency_id: 2, to_currency_id: 1, rate: '0.0001' },
      ] },
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    const tx = result.body.recentTransactions[0];
    expect(tx.id).toBe(42);
    expect(tx.amount).toBe(15000);
    expect(tx.convertedAmount).toBe(1.5); // 15000 * 0.0001
    expect(tx.currency).toBe('IDR');
    expect(tx.category).toBe('Food');
    expect(tx.createdBy.name).toBe('John');
  });

  it('returns at most 10 recent transactions', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1, date: '2026-04-05', description: `Tx ${i}`, amount: '10',
      type: 'expense', currency_id: 1, currency: 'SGD', currency_symbol: 'S$',
      category: null, payment_method: null,
      created_by_id: 1, created_by_name: 'J', created_at: '2026-04-05',
    }));
    // SQL LIMIT 10 means only 10 rows returned by DB
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ defCurId: 1 }),
      { match: 'GROUP BY currency_id', result: [] },
      { match: 'GROUP BY cat.id', result: [] },
      { match: 'LIMIT 10', result: rows.slice(0, 10) },
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    expect(result.body.recentTransactions).toHaveLength(10);
  });

  it('rounds all monetary values to 2 decimal places', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      walletMeta({ startingBalance: '0.005', defCurId: 1 }),
      { match: 'GROUP BY currency_id', result: [{
        currency_id: 1,
        today_expense: '1.005',
        week_expense: '2.335',
        month_expense: '3.999',
        month_income: '10.111',
        all_time_net: '6.112',
      }] },
    ]);

    const result = await handleGetDashboard(sql, 1, 1);
    // Math.round(1.005 * 100)/100 = 1 due to IEEE 754 (1.005*100 = 100.4999...)
    expect(result.body.today.spending).toBe(1);
    expect(result.body.thisWeek.spending).toBe(2.34);
    expect(result.body.thisMonth.spending).toBe(4);
    expect(result.body.thisMonth.income).toBe(10.11);
    expect(result.body.thisMonth.net).toBe(6.11);
    expect(result.body.currentBalance).toBe(6.12); // round2(0.005 + 6.112) = 6.12
  });
});
