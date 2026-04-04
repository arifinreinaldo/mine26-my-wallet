import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import {
  handleFetchRates,
  handleGetRecommendations,
  handleApplyRate,
  handleManualRate,
  handleGetCurrentRate,
} from '../src/handlers/rates.js';

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('handleFetchRates', () => {
  it('saves recommendations for each currency pair', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        rates: { SGD: 1.35, EUR: 0.92, USD: 1.0 },
      }),
    });

    const sql = createMockSql([
      { match: 'SELECT id, code FROM currencies', result: [
        { id: 1, code: 'USD' },
        { id: 2, code: 'SGD' },
        { id: 3, code: 'EUR' },
      ] },
      { match: 'INSERT INTO exchange_rate_recommendations', result: [] },
    ]);

    const result = await handleFetchRates(sql);
    expect(result.body.success).toBe(true);
    expect(result.body.rates).toHaveLength(2); // SGD + EUR (USD skipped)
    expect(result.body.rates[0].pair).toBe('USD/SGD');
    expect(result.body.rates[0].rate).toBe(1.35);
    // Verify INSERT called for each pair
    expect(sql.callsTo('INSERT INTO exchange_rate_recommendations')).toHaveLength(2);
  });

  it('throws on API failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const sql = createMockSql([]);
    await expect(handleFetchRates(sql)).rejects.toThrow('Failed to fetch rates');
  });

  it('skips currencies not in DB', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        rates: { SGD: 1.35, XYZ: 99.0 },
      }),
    });

    const sql = createMockSql([
      { match: 'SELECT id, code FROM currencies', result: [
        { id: 1, code: 'USD' },
        { id: 2, code: 'SGD' },
      ] },
      { match: 'INSERT INTO exchange_rate_recommendations', result: [] },
    ]);

    const result = await handleFetchRates(sql);
    expect(result.body.rates).toHaveLength(1); // Only SGD, XYZ skipped
  });
});

describe('handleGetRecommendations', () => {
  it('returns formatted recommendations', async () => {
    const sql = createMockSql([
      { match: 'FROM exchange_rate_recommendations', result: [
        {
          id: 1, pair: 'USD/SGD', recommended_rate: '1.35', current_rate: '1.30',
          current_date: '2025-01-01', difference: '0.05', percent_change: '3.85',
          source: 'exchangerate-api.com', fetched_at: '2025-01-02',
        },
      ] },
    ]);

    const result = await handleGetRecommendations(sql);
    expect(result.body.success).toBe(true);
    expect(result.body.recommendations).toHaveLength(1);
    expect(result.body.recommendations[0].recommendedRate).toBe(1.35);
    expect(result.body.recommendations[0].currentRate).toBe(1.3);
    expect(result.body.recommendations[0].percentChange).toBe(3.85);
  });

  it('handles empty recommendation list', async () => {
    const sql = createMockSql([
      { match: 'FROM exchange_rate_recommendations', result: [] },
    ]);

    const result = await handleGetRecommendations(sql);
    expect(result.body.recommendations).toHaveLength(0);
  });

  it('handles null current rate', async () => {
    const sql = createMockSql([
      { match: 'FROM exchange_rate_recommendations', result: [
        {
          id: 1, pair: 'USD/SGD', recommended_rate: '1.35', current_rate: null,
          current_date: null, difference: null, percent_change: null,
          source: 'exchangerate-api.com', fetched_at: '2025-01-02',
        },
      ] },
    ]);

    const result = await handleGetRecommendations(sql);
    expect(result.body.recommendations[0].currentRate).toBeNull();
    expect(result.body.recommendations[0].difference).toBeNull();
  });
});

describe('handleApplyRate', () => {
  it('returns 400 for missing recommendationId', async () => {
    const sql = createMockSql([]);
    const result = await handleApplyRate(sql, {});
    expect(result.status).toBe(400);
  });

  it('returns 404 for non-existent or already-applied recommendation', async () => {
    const sql = createMockSql([
      { match: 'SELECT * FROM exchange_rate_recommendations', result: [] },
    ]);
    const result = await handleApplyRate(sql, { recommendationId: 999 });
    expect(result.status).toBe(404);
    expect(result.body.message).toContain('already applied');
  });

  it('applies rate and marks recommendation', async () => {
    const sql = createMockSql([
      { match: 'SELECT * FROM exchange_rate_recommendations', result: [{
        id: 1, from_currency_id: 1, to_currency_id: 2,
        recommended_rate: '1.35', source: 'exchangerate-api.com',
      }] },
      { match: 'INSERT INTO exchange_rates', result: [] },
      { match: 'UPDATE exchange_rate_recommendations', result: [] },
    ]);

    const result = await handleApplyRate(sql, { recommendationId: 1 });
    expect(result.body.success).toBe(true);
    expect(result.body.rate).toBe(1.35);
    // Verify both INSERT and UPDATE were called
    expect(sql.callsTo('INSERT INTO exchange_rates')).toHaveLength(1);
    expect(sql.callsTo('UPDATE exchange_rate_recommendations')).toHaveLength(1);
  });
});

describe('handleManualRate', () => {
  it('returns 400 for missing fields', async () => {
    const sql = createMockSql([]);
    const result = await handleManualRate(sql, { fromCurrency: 'USD' });
    expect(result.status).toBe(400);
  });

  it('returns 400 for invalid currency codes', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, code FROM currencies', result: [{ id: 1, code: 'USD' }] },
    ]);
    const result = await handleManualRate(sql, {
      fromCurrency: 'USD', toCurrency: 'FAKE', rate: 1.5,
    });
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('Invalid currency');
  });

  it('adds rate with previous rate info', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, code FROM currencies', result: [
        { id: 1, code: 'USD' }, { id: 2, code: 'SGD' },
      ] },
      { match: 'SELECT rate FROM exchange_rates', result: [{ rate: '1.30' }] },
      { match: 'INSERT INTO exchange_rates', result: [] },
    ]);

    const result = await handleManualRate(sql, {
      fromCurrency: 'USD', toCurrency: 'SGD', rate: 1.35,
    });
    expect(result.body.success).toBe(true);
    expect(result.body.newRate).toBe(1.35);
    expect(result.body.previousRate).toBe(1.3);
  });

  it('adds rate without previous rate', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, code FROM currencies', result: [
        { id: 1, code: 'USD' }, { id: 2, code: 'SGD' },
      ] },
      { match: 'SELECT rate FROM exchange_rates', result: [] },
      { match: 'INSERT INTO exchange_rates', result: [] },
    ]);

    const result = await handleManualRate(sql, {
      fromCurrency: 'USD', toCurrency: 'SGD', rate: 1.35,
    });
    expect(result.body.previousRate).toBeNull();
  });
});

describe('handleGetCurrentRate', () => {
  it('returns 400 for missing parameters', async () => {
    const sql = createMockSql([]);
    const result = await handleGetCurrentRate(sql, null, 'SGD');
    expect(result.status).toBe(400);
  });

  it('returns rate with recommendation', async () => {
    const sql = createMockSql([
      { match: 'WITH currency_ids', result: [{
        current_rate: '1.30', effective_date: '2025-01-01', current_source: 'manual',
        recommended_rate: '1.35', rec_source: 'exchangerate-api.com',
        difference: '0.05', percent_change: '3.85',
      }] },
    ]);

    const result = await handleGetCurrentRate(sql, 'USD', 'SGD');
    expect(result.body.success).toBe(true);
    expect(result.body.pair).toBe('USD/SGD');
    expect(result.body.currentRate).toBe(1.3);
    expect(result.body.recommendedRate).toBe(1.35);
    expect(result.body.percentChange).toBe(3.85);
  });

  it('handles no data (no rate, no recommendation)', async () => {
    const sql = createMockSql([
      { match: 'WITH currency_ids', result: [undefined] },
    ]);

    const result = await handleGetCurrentRate(sql, 'USD', 'SGD');
    expect(result.body.currentRate).toBeNull();
    expect(result.body.recommendedRate).toBeNull();
  });
});
