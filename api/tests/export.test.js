import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import { escapeCsv, handleExportCsv } from '../src/handlers/export.js';

describe('handleExportCsv', () => {
  it('returns 404 for non-existent wallet', async () => {
    const sql = createMockSql([]);
    const result = await handleExportCsv(sql, 999, new URLSearchParams(), 1);
    expect(result.status).toBe(404);
  });

  it('returns 403 for non-members', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: null }] },
    ]);
    const result = await handleExportCsv(sql, 1, new URLSearchParams(), 999);
    expect(result.status).toBe(403);
  });

  it('returns csv and filename with correct headers', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'viewer' }] },
      { match: 'SELECT name FROM wallets', result: [{ name: 'My Wallet' }] },
      { match: 'FROM transactions', result: [{
        date: '2025-01-15', type: 'expense', description: 'Lunch',
        amount: '15.50', currency: 'SGD', category: 'Food',
        payment_method: 'Cash', notes: '', created_by: 'John',
      }] },
    ]);

    const result = await handleExportCsv(sql, 1, new URLSearchParams(), 1);
    expect(result.csv).toBeDefined();
    expect(result.filename).toBe('My_Wallet_transactions.csv');
    // Verify headers
    const lines = result.csv.split('\n');
    expect(lines[0]).toBe('Date,Type,Description,Amount,Currency,Category,Payment Method,Notes,Created By');
    expect(lines[1]).toContain('2025-01-15');
    expect(lines[1]).toContain('15.50');
  });

  it('sanitizes special chars in filename', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'viewer' }] },
      { match: 'SELECT name FROM wallets', result: [{ name: 'Trip $$ 2025!' }] },
      { match: 'FROM transactions', result: [] },
    ]);

    const result = await handleExportCsv(sql, 1, new URLSearchParams(), 1);
    expect(result.filename).toBe('Trip____2025__transactions.csv');
    expect(result.filename).not.toContain('$');
  });
});

describe('escapeCsv', () => {
  it('returns plain string as-is', () => {
    expect(escapeCsv('hello')).toBe('hello');
  });

  it('wraps strings with commas in quotes', () => {
    expect(escapeCsv('hello, world')).toBe('"hello, world"');
  });

  it('escapes double quotes', () => {
    expect(escapeCsv('say "hello"')).toBe('"say ""hello"""');
  });

  it('wraps strings with newlines in quotes', () => {
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
  });
});
