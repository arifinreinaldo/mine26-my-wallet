import { checkWalletAccess } from './wallets.js';

/**
 * Dashboard — single-call wallet summary optimized for Neon (few queries,
 * DB-side aggregation, parallel fetches, latest-rate conversion).
 *
 * Returns: today/week/month spending, income, net, top categories,
 * recent transactions, and current balance — all in default currency.
 */
export async function handleGetDashboard(sql, walletId, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }

  // Step 1: wallet metadata (need default_currency_id before everything else)
  const [wallet] = await sql`
    SELECT w.starting_balance, w.default_currency_id,
           c.code AS default_currency, c.symbol AS default_currency_symbol
    FROM wallets w
    LEFT JOIN currencies c ON w.default_currency_id = c.id
    WHERE w.id = ${walletId}
  `;

  const defCurId = wallet.default_currency_id;

  // Step 2: run 4 independent queries in parallel (saves ~30-60ms on Neon)
  const [periodTotals, categoryTotals, recentTx, rateRows] = await Promise.all([
    // (a) Period aggregations per currency — DB does the heavy lifting
    sql`
      SELECT
        currency_id,
        SUM(CASE WHEN type = 'expense' AND date = CURRENT_DATE THEN amount ELSE 0 END) AS today_expense,
        SUM(CASE WHEN type = 'expense' AND date >= date_trunc('week', CURRENT_DATE)::date THEN amount ELSE 0 END) AS week_expense,
        SUM(CASE WHEN type = 'expense' AND date >= date_trunc('month', CURRENT_DATE)::date THEN amount ELSE 0 END) AS month_expense,
        SUM(CASE WHEN type = 'income'  AND date >= date_trunc('month', CURRENT_DATE)::date THEN amount ELSE 0 END) AS month_income,
        SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS all_time_net
      FROM transactions
      WHERE wallet_id = ${walletId} AND deleted_at IS NULL
      GROUP BY currency_id
    `,

    // (b) Top categories this month — grouped by (category, currency) for conversion
    sql`
      SELECT cat.id AS category_id, COALESCE(cat.name, 'Uncategorized') AS category_name,
             cat.icon, t.currency_id, SUM(t.amount) AS total
      FROM transactions t
      LEFT JOIN categories cat ON t.category_id = cat.id
      WHERE t.wallet_id = ${walletId} AND t.deleted_at IS NULL
        AND t.type = 'expense'
        AND t.date >= date_trunc('month', CURRENT_DATE)::date
      GROUP BY cat.id, cat.name, cat.icon, t.currency_id
    `,

    // (c) Last 10 recent transactions
    sql`
      SELECT t.id, t.date, t.description, t.amount, t.type,
             t.currency_id, c.code AS currency, c.symbol AS currency_symbol,
             cat.name AS category, t.payment_method,
             u.id AS created_by_id, u.name AS created_by_name,
             t.created_at
      FROM transactions t
      JOIN currencies c ON t.currency_id = c.id
      LEFT JOIN categories cat ON t.category_id = cat.id
      JOIN users u ON t.created_by_user_id = u.id
      WHERE t.wallet_id = ${walletId} AND t.deleted_at IS NULL
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT 10
    `,

    // (d) Latest exchange rates for all pairs involving default currency
    //     At most ~6 rows — one per non-default currency
    sql`
      SELECT DISTINCT ON (
        LEAST(from_currency_id, to_currency_id),
        GREATEST(from_currency_id, to_currency_id)
      )
        from_currency_id, to_currency_id, rate
      FROM exchange_rates
      WHERE from_currency_id = ${defCurId} OR to_currency_id = ${defCurId}
      ORDER BY
        LEAST(from_currency_id, to_currency_id),
        GREATEST(from_currency_id, to_currency_id),
        effective_date DESC
    `,
  ]);

  // Build rate lookup: currencyId → multiplier to default currency
  const rateMap = buildRateMap(rateRows, defCurId);

  const convert = (amount, currencyId) => {
    if (!defCurId || currencyId === defCurId) return parseFloat(amount);
    const rate = rateMap.get(currencyId);
    return rate ? parseFloat(amount) * rate : parseFloat(amount);
  };

  // Aggregate period totals across currencies
  let todaySpending = 0, weekSpending = 0, monthSpending = 0, monthIncome = 0, allTimeNet = 0;
  for (const row of periodTotals) {
    todaySpending += convert(row.today_expense, row.currency_id);
    weekSpending += convert(row.week_expense, row.currency_id);
    monthSpending += convert(row.month_expense, row.currency_id);
    monthIncome += convert(row.month_income, row.currency_id);
    allTimeNet += convert(row.all_time_net, row.currency_id);
  }

  // Aggregate category totals across currencies, then pick top 5
  const catMap = new Map();
  for (const row of categoryTotals) {
    const key = row.category_id ?? 'uncategorized';
    const existing = catMap.get(key) || { categoryId: row.category_id, name: row.category_name, icon: row.icon, total: 0 };
    existing.total += convert(row.total, row.currency_id);
    catMap.set(key, existing);
  }
  const topCategories = [...catMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map(c => ({ categoryId: c.categoryId, name: c.name, icon: c.icon, total: round2(c.total) }));

  // Format recent transactions
  const recentTransactions = recentTx.map(t => ({
    id: t.id,
    date: t.date,
    description: t.description,
    amount: parseFloat(t.amount),
    convertedAmount: round2(convert(t.amount, t.currency_id)),
    type: t.type,
    currency: t.currency,
    currencySymbol: t.currency_symbol,
    category: t.category,
    paymentMethod: t.payment_method,
    createdBy: { id: t.created_by_id, name: t.created_by_name },
    createdAt: t.created_at,
  }));

  const startingBalance = parseFloat(wallet.starting_balance);

  return {
    body: {
      success: true,
      walletId: parseInt(walletId),
      defaultCurrency: wallet.default_currency,
      defaultCurrencySymbol: wallet.default_currency_symbol,
      today: {
        spending: round2(todaySpending),
      },
      thisWeek: {
        spending: round2(weekSpending),
      },
      thisMonth: {
        spending: round2(monthSpending),
        income: round2(monthIncome),
        net: round2(monthIncome - monthSpending),
      },
      topCategories,
      recentTransactions,
      currentBalance: round2(startingBalance + allTimeNet),
    },
  };
}

/**
 * Build a Map of currencyId → conversion multiplier to the default currency.
 * Uses the latest rate for each pair (not per-date — acceptable for dashboard summaries).
 */
function buildRateMap(rateRows, defaultCurrencyId) {
  const map = new Map();
  for (const row of rateRows) {
    const rate = parseFloat(row.rate);
    if (row.from_currency_id === defaultCurrencyId) {
      // rate is default→other, we need other→default = 1/rate
      map.set(row.to_currency_id, 1.0 / rate);
    } else {
      // rate is other→default
      map.set(row.from_currency_id, rate);
    }
  }
  return map;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
