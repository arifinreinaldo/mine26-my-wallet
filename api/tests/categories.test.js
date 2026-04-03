import { describe, it, expect } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import {
  handleGetCategories,
  handleCreateCategory,
  handleEditCategory,
  handleDeleteCategory,
} from '../src/handlers/categories.js';

describe('handleCreateCategory', () => {
  it('returns 400 for missing name', async () => {
    const sql = createMockSql([]);
    const result = await handleCreateCategory(sql, { icon: 'test' }, 1);
    expect(result.status).toBe(400);
  });

  it('returns 403 for viewers on wallet-scoped category', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'viewer' }] },
    ]);
    const result = await handleCreateCategory(sql, { name: 'Test', walletId: 1 }, 1);
    expect(result.status).toBe(403);
  });

  it('creates category successfully', async () => {
    const sql = createMockSql([
      { match: 'SELECT w.id', result: [{ id: 1, role: 'editor' }] },
      { match: 'INSERT INTO categories', result: [{ id: 9, name: 'Custom', icon: 'star', color: '#FF0000' }] },
    ]);
    const result = await handleCreateCategory(sql, {
      name: 'Custom', icon: 'star', color: '#FF0000', walletId: 1,
    }, 1);
    expect(result.body.success).toBe(true);
    expect(result.body.category.name).toBe('Custom');
  });
});

describe('handleEditCategory', () => {
  it('returns 404 for non-existent category', async () => {
    const sql = createMockSql([]);
    const result = await handleEditCategory(sql, 999, { name: 'New' }, 1);
    expect(result.status).toBe(404);
  });

  it('returns 403 for seeded/global categories', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, wallet_id', result: [{ id: 1, wallet_id: null, created_by_user_id: null }] },
    ]);
    const result = await handleEditCategory(sql, 1, { name: 'New' }, 1);
    expect(result.status).toBe(403);
    expect(result.body.message).toContain('default');
  });
});

describe('handleDeleteCategory', () => {
  it('returns 403 for seeded categories', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, wallet_id', result: [{ id: 1, wallet_id: null }] },
    ]);
    const result = await handleDeleteCategory(sql, 1, 1);
    expect(result.status).toBe(403);
  });
});

describe('handleGetCategories', () => {
  it('returns global + wallet-scoped categories', async () => {
    const sql = createMockSql([
      { match: 'FROM categories', result: [
        { id: 1, name: 'Food', icon: null, color: null, wallet_id: null, parent_id: null },
        { id: 9, name: 'Custom', icon: 'star', color: '#FF0000', wallet_id: 1, parent_id: null },
      ] },
    ]);
    const params = new URLSearchParams({ walletId: '1' });
    const result = await handleGetCategories(sql, params, 1);
    expect(result.body.categories).toHaveLength(2);
    expect(result.body.categories[0].isCustom).toBe(false);
    expect(result.body.categories[1].isCustom).toBe(true);
  });
});
