/**
 * Fetch current exchange rates from API and save as recommendations
 */
export async function handleFetchRates(sql) {
  const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
  const data = await response.json();
  const rates = data.rates;
  const source = 'exchangerate-api.com';

  const currencies = await sql`
    SELECT id, code FROM currencies
    WHERE code = ANY(ARRAY['USD', 'SGD', 'EUR', 'MYR', 'GBP', 'JPY'])
  `;

  const currencyMap = Object.fromEntries(
    currencies.map((c) => [c.code, c.id])
  );

  const baseId = currencyMap['USD'];
  const savedRates = [];

  for (const [targetCode, rate] of Object.entries(rates)) {
    if (targetCode === 'USD' || !currencyMap[targetCode]) continue;

    const targetId = currencyMap[targetCode];

    await sql`
      INSERT INTO exchange_rate_recommendations
      (from_currency_id, to_currency_id, recommended_rate, source, notes)
      VALUES (${baseId}, ${targetId}, ${rate}, ${source},
              ${'Auto-fetched from ' + source})
    `;

    savedRates.push({
      pair: `USD/${targetCode}`,
      rate: parseFloat(rate),
      source,
    });
  }

  return {
    body: {
      success: true,
      message: `Fetched ${savedRates.length} rate recommendations`,
      rates: savedRates,
    },
  };
}

/**
 * Get pending rate recommendations with comparison to current rates
 */
export async function handleGetRecommendations(sql) {
  const recommendations = await sql`
    SELECT
      rec.id,
      c1.code || '/' || c2.code AS pair,
      rec.recommended_rate,
      rec.source,
      rec.fetched_at,
      er.rate AS current_rate,
      er.effective_date AS current_date,
      rec.recommended_rate - COALESCE(er.rate, 0) AS difference,
      CASE
        WHEN er.rate IS NOT NULL THEN
          ROUND(((rec.recommended_rate - er.rate) / er.rate * 100)::numeric, 2)
        ELSE NULL
      END AS percent_change
    FROM exchange_rate_recommendations rec
    JOIN currencies c1 ON rec.from_currency_id = c1.id
    JOIN currencies c2 ON rec.to_currency_id = c2.id
    LEFT JOIN LATERAL (
      SELECT rate, effective_date
      FROM exchange_rates
      WHERE from_currency_id = rec.from_currency_id
        AND to_currency_id = rec.to_currency_id
      ORDER BY effective_date DESC
      LIMIT 1
    ) er ON true
    WHERE rec.is_applied = FALSE
    ORDER BY rec.fetched_at DESC
  `;

  return {
    body: {
      success: true,
      recommendations: recommendations.map((r) => ({
        id: r.id,
        pair: r.pair,
        recommendedRate: parseFloat(r.recommended_rate),
        currentRate: r.current_rate ? parseFloat(r.current_rate) : null,
        currentDate: r.current_date,
        difference: r.difference ? parseFloat(r.difference) : null,
        percentChange: r.percent_change ? parseFloat(r.percent_change) : null,
        source: r.source,
        fetchedAt: r.fetched_at,
      })),
    },
  };
}

/**
 * Apply a recommended rate
 */
export async function handleApplyRate(sql, body) {
  const { recommendationId, notes } = body;

  const [rec] = await sql`
    SELECT * FROM exchange_rate_recommendations
    WHERE id = ${recommendationId} AND is_applied = FALSE
  `;

  if (!rec) {
    return {
      status: 404,
      body: { success: false, message: 'Recommendation not found or already applied' },
    };
  }

  await sql`
    INSERT INTO exchange_rates
    (from_currency_id, to_currency_id, rate, effective_date, source, is_manual, notes)
    VALUES (
      ${rec.from_currency_id},
      ${rec.to_currency_id},
      ${rec.recommended_rate},
      CURRENT_DATE,
      ${rec.source},
      FALSE,
      ${notes || 'Applied from recommendation'}
    )
    ON CONFLICT (from_currency_id, to_currency_id, effective_date)
    DO UPDATE SET
      rate = EXCLUDED.rate,
      source = EXCLUDED.source,
      is_manual = EXCLUDED.is_manual,
      notes = EXCLUDED.notes
  `;

  await sql`
    UPDATE exchange_rate_recommendations
    SET is_applied = TRUE, applied_at = NOW()
    WHERE id = ${recommendationId}
  `;

  return {
    body: {
      success: true,
      message: 'Rate applied successfully',
      rate: parseFloat(rec.recommended_rate),
    },
  };
}

/**
 * Add manual exchange rate
 */
export async function handleManualRate(sql, body) {
  const { fromCurrency, toCurrency, rate, notes } = body;

  const currencies = await sql`
    SELECT id, code FROM currencies
    WHERE code IN (${fromCurrency}, ${toCurrency})
  `;

  const currencyMap = Object.fromEntries(currencies.map((c) => [c.code, c.id]));
  const fromId = currencyMap[fromCurrency];
  const toId = currencyMap[toCurrency];

  if (!fromId || !toId) {
    return {
      status: 400,
      body: { success: false, message: 'Invalid currency codes' },
    };
  }

  const [prevRate] = await sql`
    SELECT rate FROM exchange_rates
    WHERE from_currency_id = ${fromId} AND to_currency_id = ${toId}
    ORDER BY effective_date DESC
    LIMIT 1
  `;

  await sql`
    INSERT INTO exchange_rates
    (from_currency_id, to_currency_id, rate, effective_date, source, is_manual, notes)
    VALUES (${fromId}, ${toId}, ${rate}, CURRENT_DATE, 'manual', TRUE, ${notes || null})
    ON CONFLICT (from_currency_id, to_currency_id, effective_date)
    DO UPDATE SET
      rate = EXCLUDED.rate,
      source = EXCLUDED.source,
      is_manual = EXCLUDED.is_manual,
      notes = EXCLUDED.notes
  `;

  return {
    body: {
      success: true,
      message: 'Manual rate added successfully',
      newRate: parseFloat(rate),
      previousRate: prevRate ? parseFloat(prevRate.rate) : null,
    },
  };
}

/**
 * Get current rate with recommendation
 */
export async function handleGetCurrentRate(sql, fromCurrency, toCurrency) {
  const [result] = await sql`
    WITH currency_ids AS (
      SELECT
        MAX(CASE WHEN code = ${fromCurrency} THEN id END) as from_id,
        MAX(CASE WHEN code = ${toCurrency} THEN id END) as to_id
      FROM currencies
    ),
    current_rate AS (
      SELECT rate, effective_date, source
      FROM exchange_rates, currency_ids
      WHERE from_currency_id = currency_ids.from_id
        AND to_currency_id = currency_ids.to_id
      ORDER BY effective_date DESC
      LIMIT 1
    ),
    latest_recommendation AS (
      SELECT recommended_rate, source, fetched_at
      FROM exchange_rate_recommendations, currency_ids
      WHERE from_currency_id = currency_ids.from_id
        AND to_currency_id = currency_ids.to_id
        AND is_applied = FALSE
      ORDER BY fetched_at DESC
      LIMIT 1
    )
    SELECT
      cr.rate as current_rate,
      cr.effective_date,
      cr.source as current_source,
      rec.recommended_rate,
      rec.source as rec_source,
      rec.recommended_rate - cr.rate as difference,
      ROUND(((rec.recommended_rate - cr.rate) / cr.rate * 100)::numeric, 2) as percent_change
    FROM current_rate cr
    FULL OUTER JOIN latest_recommendation rec ON true
  `;

  return {
    body: {
      success: true,
      pair: `${fromCurrency}/${toCurrency}`,
      currentRate: result?.current_rate ? parseFloat(result.current_rate) : null,
      currentDate: result?.effective_date,
      recommendedRate: result?.recommended_rate ? parseFloat(result.recommended_rate) : null,
      difference: result?.difference ? parseFloat(result.difference) : null,
      percentChange: result?.percent_change ? parseFloat(result.percent_change) : null,
    },
  };
}
