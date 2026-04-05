import { checkWalletAccess } from './wallets.js';

/**
 * Get spending report for a wallet, converted to target currency.
 *
 * Optimised for Neon (few queries, DB-side aggregation):
 *   Step 1: wallet + currency metadata
 *   Step 2: 5 parallel queries — summary aggregations (DB-side) + paginated tx list + rates
 *   Step 3: JS converts small result sets using rate map
 */
export async function handleGetSpendingReport(sql, walletId, searchParams, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }

  const targetCurrency = searchParams.get('currency') || 'SGD';
  const fromDate = searchParams.get('from');
  const toDate = searchParams.get('to');
  const limit = Math.min(parseInt(searchParams.get('limit')) || 50, 200);
  const page = Math.max(parseInt(searchParams.get('page')) || 1, 1);
  const offset = (page - 1) * limit;

  const [targetCurr] = await sql`
    SELECT id FROM currencies WHERE code = ${targetCurrency}
  `;
  if (!targetCurr) {
    return { status: 400, body: { success: false, message: 'Invalid target currency' } };
  }

  const [wallet] = await sql`
    SELECT starting_balance FROM wallets WHERE id = ${walletId}
  `;

  // Shared WHERE filter for all aggregation queries
  // Run 5 queries in parallel: 4 summary aggregations + 1 paginated tx list
  const [incomeTotals, categoryRows, monthlyRows, userRows, transactions] = await Promise.all([
    // (a) Income/expense totals per currency
    sql`
      SELECT currency_id, type,
        SUM(amount) AS total, COUNT(*) AS cnt
      FROM transactions
      WHERE wallet_id = ${walletId} AND deleted_at IS NULL
        AND (${fromDate}::date IS NULL OR date >= ${fromDate}::date)
        AND (${toDate}::date IS NULL OR date <= ${toDate}::date)
      GROUP BY currency_id, type
    `,

    // (b) Category totals per currency (expenses only)
    sql`
      SELECT COALESCE(cat.name, 'Uncategorized') AS category, t.currency_id,
        SUM(t.amount) AS total
      FROM transactions t
      LEFT JOIN categories cat ON t.category_id = cat.id
      WHERE t.wallet_id = ${walletId} AND t.deleted_at IS NULL AND t.type = 'expense'
        AND (${fromDate}::date IS NULL OR t.date >= ${fromDate}::date)
        AND (${toDate}::date IS NULL OR t.date <= ${toDate}::date)
      GROUP BY cat.name, t.currency_id
    `,

    // (c) Monthly cash flow per currency
    sql`
      SELECT to_char(date, 'YYYY-MM') AS month, currency_id, type,
        SUM(amount) AS total
      FROM transactions
      WHERE wallet_id = ${walletId} AND deleted_at IS NULL
        AND (${fromDate}::date IS NULL OR date >= ${fromDate}::date)
        AND (${toDate}::date IS NULL OR date <= ${toDate}::date)
      GROUP BY month, currency_id, type
    `,

    // (d) User totals per currency
    sql`
      SELECT u.name, t.currency_id, SUM(t.amount) AS total
      FROM transactions t
      JOIN users u ON t.created_by_user_id = u.id
      WHERE t.wallet_id = ${walletId} AND t.deleted_at IS NULL
        AND (${fromDate}::date IS NULL OR t.date >= ${fromDate}::date)
        AND (${toDate}::date IS NULL OR t.date <= ${toDate}::date)
      GROUP BY u.name, t.currency_id
    `,

    // (e) Paginated transaction list
    sql`
      SELECT
        t.id, t.date, t.description, t.amount, t.type,
        c.code AS currency_code, c.id AS currency_id,
        cat.name AS category_name, t.payment_method,
        u.id AS created_by_id, u.name AS created_by_name
      FROM transactions t
      JOIN currencies c ON t.currency_id = c.id
      LEFT JOIN categories cat ON t.category_id = cat.id
      JOIN users u ON t.created_by_user_id = u.id
      WHERE t.wallet_id = ${walletId} AND t.deleted_at IS NULL
        AND (${fromDate}::date IS NULL OR t.date >= ${fromDate}::date)
        AND (${toDate}::date IS NULL OR t.date <= ${toDate}::date)
      ORDER BY t.date DESC
      LIMIT ${limit + 1} OFFSET ${offset}
    `,
  ]);

  const hasMore = transactions.length > limit;
  const txPage = hasMore ? transactions.slice(0, limit) : transactions;

  // Latest rates for currency conversion (summary uses latest, tx list uses per-date)
  const latestRates = await sql`
    SELECT DISTINCT ON (
      LEAST(from_currency_id, to_currency_id),
      GREATEST(from_currency_id, to_currency_id)
    )
      from_currency_id, to_currency_id, rate
    FROM exchange_rates
    WHERE from_currency_id = ${targetCurr.id} OR to_currency_id = ${targetCurr.id}
    ORDER BY
      LEAST(from_currency_id, to_currency_id),
      GREATEST(from_currency_id, to_currency_id),
      effective_date DESC
  `;

  // Build latest-rate map: currencyId → multiplier to target
  const latestRateMap = new Map();
  for (const row of latestRates) {
    const rate = parseFloat(row.rate);
    if (row.from_currency_id === targetCurr.id) {
      latestRateMap.set(row.to_currency_id, 1.0 / rate);
    } else {
      latestRateMap.set(row.from_currency_id, rate);
    }
  }

  const convertLatest = (amount, currencyId) => {
    if (currencyId === targetCurr.id) return parseFloat(amount);
    const rate = latestRateMap.get(currencyId);
    return rate ? parseFloat(amount) * rate : parseFloat(amount);
  };

  // Aggregate income/expense from DB-side totals
  let totalIncome = 0, totalExpense = 0, totalTransactions = 0;
  for (const row of incomeTotals) {
    const converted = convertLatest(row.total, row.currency_id);
    if (row.type === 'income') totalIncome += converted;
    else totalExpense += converted;
    totalTransactions += parseInt(row.cnt);
  }

  // Category totals
  const categoryTotals = {};
  for (const row of categoryRows) {
    const cat = row.category;
    categoryTotals[cat] = (categoryTotals[cat] || 0) + convertLatest(row.total, row.currency_id);
  }

  // Monthly totals & cash flow
  const monthlyTotals = {};
  const monthlyCashFlow = {};
  for (const row of monthlyRows) {
    const m = row.month;
    const converted = convertLatest(row.total, row.currency_id);
    if (!monthlyCashFlow[m]) monthlyCashFlow[m] = { income: 0, expense: 0 };
    if (row.type === 'income') {
      monthlyCashFlow[m].income += converted;
      monthlyTotals[m] = (monthlyTotals[m] || 0) + converted;
    } else {
      monthlyCashFlow[m].expense += converted;
      monthlyTotals[m] = (monthlyTotals[m] || 0) - converted;
    }
  }

  // User totals
  const userTotals = {};
  for (const row of userRows) {
    userTotals[row.name] = (userTotals[row.name] || 0) + convertLatest(row.total, row.currency_id);
  }

  // Per-date rates for paginated transaction list (batch fetch)
  const rateMap = new Map();
  const uniquePairs = new Map();
  for (const t of txPage) {
    if (t.currency_id === targetCurr.id) continue;
    const key = `${t.currency_id}:${t.date}`;
    if (!uniquePairs.has(key)) uniquePairs.set(key, { currencyId: t.currency_id, date: t.date });
  }

  if (uniquePairs.size > 0) {
    const fromIds = [...uniquePairs.values()].map(p => p.currencyId);
    const dates = [...uniquePairs.values()].map(p => p.date);
    const rateRows = await sql`
      SELECT sub.from_id, sub.dt::text AS dt, er.rate, er.from_currency_id, er.to_currency_id
      FROM (SELECT unnest(${fromIds}::int[]) AS from_id, unnest(${dates}::date[]) AS dt) sub
      LEFT JOIN LATERAL (
        SELECT rate, from_currency_id, to_currency_id FROM exchange_rates
        WHERE ((from_currency_id = sub.from_id AND to_currency_id = ${targetCurr.id})
            OR (from_currency_id = ${targetCurr.id} AND to_currency_id = sub.from_id))
          AND effective_date <= sub.dt
        ORDER BY effective_date DESC LIMIT 1
      ) er ON true
    `;
    for (const row of rateRows) {
      const key = `${row.from_id}:${row.dt}`;
      if (!row.rate) { rateMap.set(key, null); continue; }
      rateMap.set(key, row.from_currency_id === row.from_id
        ? parseFloat(row.rate) : 1.0 / parseFloat(row.rate));
    }
  }

  const convertedTransactions = txPage.map(t => {
    const rate = t.currency_id === targetCurr.id
      ? 1.0
      : rateMap.get(`${t.currency_id}:${t.date}`) ?? null;
    return {
      id: t.id, date: t.date, description: t.description,
      originalAmount: parseFloat(t.amount), originalCurrency: t.currency_code,
      type: t.type,
      convertedAmount: rate ? parseFloat(t.amount) * rate : null,
      exchangeRate: rate,
      category: t.category_name, paymentMethod: t.payment_method,
      createdBy: { id: t.created_by_id, name: t.created_by_name },
    };
  });

  return {
    body: {
      success: true,
      walletId: parseInt(walletId),
      targetCurrency,
      page,
      limit,
      hasMore,
      transactions: convertedTransactions,
      summary: {
        totalTransactions,
        totalIncome,
        totalExpense,
        netCashFlow: totalIncome - totalExpense,
        startingBalance: parseFloat(wallet.starting_balance),
        currentBalance: parseFloat(wallet.starting_balance) + (totalIncome - totalExpense),
        monthlyTotals,
        monthlyCashFlow,
        categoryTotals,
        userTotals,
      },
    },
  };
}
