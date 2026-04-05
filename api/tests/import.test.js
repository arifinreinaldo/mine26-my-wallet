import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import { handleImport } from '../src/handlers/import.js';

function walletAccess(role) {
  return { match: 'SELECT w.id', result: [{ id: 1, role }] };
}

function currencyLookup(currencies) {
  return { match: 'SELECT id, code FROM currencies', result: currencies };
}

function categoryLookup(categories) {
  return { match: 'SELECT id, name FROM categories', result: categories };
}

describe('handleImport', () => {
  it('returns 404 for non-existent wallet', async () => {
    const sql = createMockSql([]);
    const result = await handleImport(sql, 999, { transactions: [{}] }, 1);
    expect(result.status).toBe(404);
  });

  it('returns 403 for viewers', async () => {
    const sql = createMockSql([walletAccess('viewer')]);
    const result = await handleImport(sql, 1, { transactions: [{}] }, 1);
    expect(result.status).toBe(403);
  });

  it('returns 400 for empty transactions array', async () => {
    const sql = createMockSql([walletAccess('editor')]);
    const result = await handleImport(sql, 1, { transactions: [] }, 1);
    expect(result.status).toBe(400);
  });

  it('returns 400 for missing transactions field', async () => {
    const sql = createMockSql([walletAccess('editor')]);
    const result = await handleImport(sql, 1, {}, 1);
    expect(result.status).toBe(400);
  });

  it('returns 400 when batch exceeds limit', async () => {
    const sql = createMockSql([walletAccess('editor')]);
    const big = Array(1001).fill({ date: '2025-01-01', amount: 10, currencyCode: 'SGD' });
    const result = await handleImport(sql, 1, { transactions: big }, 1);
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('1000');
  });

  it('imports valid transactions', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([{ id: 1, name: 'Food & Dining' }]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04T05:00:00Z', type: 'Expense', categoryName: 'Food & Dining', amount: -72770, currencyCode: 'IDR', description: 'Lei cha' },
        { date: '2026-03-04', type: 'Income', amount: 1023854, currencyCode: 'IDR', description: 'Salary' },
      ],
    }, 1);

    expect(result.body.success).toBe(true);
    expect(result.body.imported).toBe(2);
    expect(result.body.skipped).toBe(0);
    expect(result.body.total).toBe(2);
    expect(result.body.errors).toBeUndefined();
  });

  it('strips time from ISO date', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04T05:30:00Z', amount: 100, currencyCode: 'IDR' },
      ],
    }, 1);

    // The INSERT call should have date = '2026-03-04'
    const insertCall = sql.callsTo('INSERT INTO transactions')[0];
    expect(insertCall.values).toContain('2026-03-04');
  });

  it('uses absolute value for negative amounts', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', type: 'Expense', amount: -72770, currencyCode: 'IDR' },
      ],
    }, 1);

    const insertCall = sql.callsTo('INSERT INTO transactions')[0];
    expect(insertCall.values).toContain(72770); // absolute value
  });

  it('maps Spendee category aliases', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([
        { id: 1, name: 'Food & Dining' },
        { id: 5, name: 'Bills & Utilities' },
      ]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR', categoryName: 'Food & Drink' },
        { date: '2026-03-05', amount: 200, currencyCode: 'IDR', categoryName: 'Utilities' },
      ],
    }, 1);

    const inserts = sql.callsTo('INSERT INTO transactions');
    // Food & Drink → Food & Dining (id 1)
    expect(inserts[0].values).toContain(1);
    // Utilities → Bills & Utilities (id 5)
    expect(inserts[1].values).toContain(5);
  });

  it('sets categoryId to null for unmatched categories', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR', categoryName: 'UnknownCat' },
      ],
    }, 1);

    expect(result.body.imported).toBe(1);
    const insertCall = sql.callsTo('INSERT INTO transactions')[0];
    expect(insertCall.values).toContain(null); // categoryId is null
  });

  it('skips rows with invalid currency', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'FAKE' },
      ],
    }, 1);

    expect(result.body.imported).toBe(0);
    expect(result.body.skipped).toBe(1);
    expect(result.body.errors[0].error).toContain('Invalid currency');
  });

  it('skips rows missing required fields', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([]),
      categoryLookup([]),
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { description: 'no date or amount' },
      ],
    }, 1);

    expect(result.body.skipped).toBe(1);
    expect(result.body.errors[0].error).toContain('required');
  });

  it('defaults type to expense when not specified', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR' },
      ],
    }, 1);

    const insertCall = sql.callsTo('INSERT INTO transactions')[0];
    expect(insertCall.values).toContain('expense');
  });

  it('handles mixed valid and invalid rows', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR' },
        { description: 'missing fields' },
        { date: '2026-03-05', amount: 200, currencyCode: 'IDR' },
      ],
    }, 1);

    expect(result.body.imported).toBe(2);
    expect(result.body.skipped).toBe(1);
    expect(result.body.total).toBe(3);
  });
});
