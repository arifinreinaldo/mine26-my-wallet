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

  it('returns 403 for non-members', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: null }] },
    ]);
    const result = await handleImport(sql, 1, { transactions: [{}] }, 999);
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

  it('auto-creates missing categories as wallet-scoped', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
      { match: 'INSERT INTO categories', result: [{ id: 99, name: 'Gunpla' }] },
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR', categoryName: 'Gunpla' },
      ],
    }, 1);

    expect(result.body.imported).toBe(1);
    expect(result.body.categoriesCreated).toEqual(['Gunpla']);
    // Verify category was inserted as wallet-scoped
    const catInsert = sql.callsTo('INSERT INTO categories')[0];
    expect(catInsert.query).toContain('wallet_id');
    // Transaction should use the newly created category id
    const txInsert = sql.callsTo('INSERT INTO transactions')[0];
    expect(txInsert.values).toContain(99);
  });

  it('auto-creates aliased category with canonical name when target missing', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]), // "Food & Dining" does NOT exist in DB
      { match: 'INSERT INTO categories', result: [{ id: 50, name: 'Food & Dining' }] },
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR', categoryName: 'Food & Drink' },
      ],
    }, 1);

    expect(result.body.imported).toBe(1);
    // Should create "Food & Dining" (canonical), not "Food & Drink" (Spendee name)
    expect(result.body.categoriesCreated).toEqual(['Food & Dining']);
    // Transaction should use the created category id
    const txInsert = sql.callsTo('INSERT INTO transactions')[0];
    expect(txInsert.values).toContain(50);
  });

  it('does not duplicate auto-created categories across rows', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
      { match: 'INSERT INTO categories', result: [{ id: 99, name: 'Gunpla' }] },
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR', categoryName: 'Gunpla' },
        { date: '2026-03-05', amount: 200, currencyCode: 'IDR', categoryName: 'Gunpla' },
      ],
    }, 1);

    expect(result.body.imported).toBe(2);
    // Category should only be created once
    expect(sql.callsTo('INSERT INTO categories')).toHaveLength(1);
    expect(result.body.categoriesCreated).toEqual(['Gunpla']);
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

  it('skips rows with zero amount', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 0, currencyCode: 'IDR' },
      ],
    }, 1);

    expect(result.body.skipped).toBe(1);
    expect(result.body.errors[0].error).toContain('non-zero');
  });

  it('skips rows with NaN amount', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 'abc', currencyCode: 'IDR' },
      ],
    }, 1);

    expect(result.body.skipped).toBe(1);
    expect(result.body.errors[0].error).toContain('non-zero');
  });

  it('handles DB error during transaction insert', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([]),
      { match: 'INSERT INTO transactions', throws: new Error('unique constraint violated') },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR' },
      ],
    }, 1);

    expect(result.body.imported).toBe(0);
    expect(result.body.skipped).toBe(1);
    expect(result.body.errors[0].error).toBe('unique constraint violated');
  });

  it('sets null categoryId when no categoryName provided', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([{ id: 1, name: 'Food & Dining' }]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR' },
      ],
    }, 1);

    expect(result.body.imported).toBe(1);
    expect(result.body.categoriesCreated).toBeUndefined();
    // No category auto-creation should happen
    expect(sql.callsTo('INSERT INTO categories')).toHaveLength(0);
  });

  it('matches categories case-insensitively', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([{ id: 3, name: 'Shopping' }]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR', categoryName: 'shopping' },
        { date: '2026-03-05', amount: 200, currencyCode: 'IDR', categoryName: 'SHOPPING' },
      ],
    }, 1);

    const inserts = sql.callsTo('INSERT INTO transactions');
    expect(inserts[0].values).toContain(3);
    expect(inserts[1].values).toContain(3);
    // No new categories created
    expect(sql.callsTo('INSERT INTO categories')).toHaveLength(0);
  });

  it('handles multiple currencies in one batch', async () => {
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }, { id: 2, code: 'SGD' }]),
      categoryLookup([]),
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 72770, currencyCode: 'IDR' },
        { date: '2026-03-04', amount: 15.50, currencyCode: 'SGD' },
      ],
    }, 1);

    expect(result.body.imported).toBe(2);
    const inserts = sql.callsTo('INSERT INTO transactions');
    expect(inserts[0].values).toContain(1); // IDR id
    expect(inserts[1].values).toContain(2); // SGD id
  });

  it('auto-creates multiple new categories in one batch', async () => {
    let catId = 100;
    const sql = createMockSql([
      walletAccess('editor'),
      currencyLookup([{ id: 1, code: 'IDR' }]),
      categoryLookup([{ id: 1, name: 'Food & Dining' }]),
      { match: 'INSERT INTO categories', result: (values) => [{ id: catId++, name: values[0] }] },
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04', amount: 100, currencyCode: 'IDR', categoryName: 'Gunpla' },
        { date: '2026-03-05', amount: 200, currencyCode: 'IDR', categoryName: 'Grocery' },
        { date: '2026-03-06', amount: 300, currencyCode: 'IDR', categoryName: 'Food & Dining' },
      ],
    }, 1);

    expect(result.body.imported).toBe(3);
    // Two new categories created, Food & Dining already existed
    expect(result.body.categoriesCreated).toHaveLength(2);
    expect(result.body.categoriesCreated).toContain('Gunpla');
    expect(result.body.categoriesCreated).toContain('Grocery');
    expect(sql.callsTo('INSERT INTO categories')).toHaveLength(2);
  });

  it('realistic Spendee batch import', async () => {
    const sql = createMockSql([
      walletAccess('owner'),
      currencyLookup([{ id: 7, code: 'IDR' }]),
      categoryLookup([
        { id: 1, name: 'Food & Dining' },
        { id: 3, name: 'Shopping' },
        { id: 6, name: 'Healthcare' },
        { id: 5, name: 'Bills & Utilities' },
      ]),
      { match: 'INSERT INTO categories', result: (values) => [{ id: 99, name: values[0] }] },
      { match: 'INSERT INTO transactions', result: [] },
    ]);

    const result = await handleImport(sql, 1, {
      transactions: [
        { date: '2026-03-04T05:00:00Z', type: 'Expense', categoryName: 'Food & Drink', amount: -72770.54, currencyCode: 'IDR', description: 'Lei cha' },
        { date: '2026-03-05T08:00:00Z', type: 'Expense', categoryName: 'Shopping', amount: -64782.54, currencyCode: 'IDR', description: 'Sarung koper' },
        { date: '2026-03-05T08:00:00Z', type: 'Income', categoryName: 'Gunpla', amount: 1023854.4, currencyCode: 'IDR', description: 'Eternal star glory stargazer' },
        { date: '2026-03-07T00:00:00Z', type: 'Expense', categoryName: 'Healthcare', amount: -1953240, currencyCode: 'IDR', description: 'Asuransi' },
        { date: '2026-03-17T10:00:00Z', type: 'Expense', categoryName: 'Utilities', amount: -82000, currencyCode: 'IDR', description: 'Internet and pulsa mami 195' },
        { date: '2026-03-17T04:00:00Z', type: 'Expense', categoryName: 'Accommodation', amount: -1991400, currencyCode: 'IDR', description: 'Socia onl mayo' },
        { date: '2026-03-09T10:00:00Z', type: 'Income', categoryName: 'Extra income', amount: 164925, currencyCode: 'IDR', description: 'Harry Potter card' },
      ],
    }, 1);

    expect(result.body.success).toBe(true);
    expect(result.body.imported).toBe(7);
    expect(result.body.skipped).toBe(0);
    expect(result.body.total).toBe(7);
    // "Gunpla", "Accommodation", "Extra income" auto-created
    // "Food & Drink" → "Food & Dining", "Utilities" → "Bills & Utilities" aliased
    expect(result.body.categoriesCreated).toContain('Gunpla');
    expect(result.body.categoriesCreated).toContain('Accommodation');
    expect(result.body.categoriesCreated).toContain('Extra income');
    expect(result.body.categoriesCreated).not.toContain('Food & Drink');
    expect(result.body.categoriesCreated).not.toContain('Utilities');

    // Verify amounts are absolute values
    const inserts = sql.callsTo('INSERT INTO transactions');
    expect(inserts[0].values).toContain(72770.54); // not -72770.54
    expect(inserts[3].values).toContain(1953240);

    // Verify dates stripped of time
    expect(inserts[0].values).toContain('2026-03-04');
    expect(inserts[4].values).toContain('2026-03-17');

    // Verify income type
    expect(inserts[2].values).toContain('income');
    expect(inserts[6].values).toContain('income');
    // Verify expense type
    expect(inserts[0].values).toContain('expense');
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
