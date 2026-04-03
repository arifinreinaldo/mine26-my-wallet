import { checkWalletAccess } from './wallets.js';

/**
 * Get spending report for a wallet, converted to target currency
 */
export async function handleGetSpendingReport(sql, walletId, searchParams, authUserId) {
  // Verify user is a member
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

  // Get target currency ID
  const [targetCurr] = await sql`
    SELECT id FROM currencies WHERE code = ${targetCurrency}
  `;

  if (!targetCurr) {
    return {
      status: 400,
      body: { success: false, message: 'Invalid target currency' },
    };
  }

  // Get wallet starting balance
  const [wallet] = await sql`
    SELECT starting_balance FROM wallets WHERE id = ${walletId}
  `;

  // Get transactions for this wallet
  const transactions = await sql`
    SELECT
      t.id,
      t.date,
      t.description,
      t.amount,
      t.type,
      c.code AS currency_code,
      c.id AS currency_id,
      cat.name AS category_name,
      t.payment_method,
      u.id AS created_by_id,
      u.name AS created_by_name
    FROM transactions t
    JOIN currencies c ON t.currency_id = c.id
    LEFT JOIN categories cat ON t.category_id = cat.id
    JOIN users u ON t.created_by_user_id = u.id
    WHERE t.wallet_id = ${walletId}
      AND (${fromDate}::date IS NULL OR t.date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR t.date <= ${toDate}::date)
    ORDER BY t.date DESC
  `;

  // Batch-fetch all exchange rates needed for conversion
  const rateMap = new Map(); // "currencyId:date" -> rate

  // Collect unique (currency_id, date) pairs needing conversion
  const uniquePairs = new Map();
  for (const t of transactions) {
    if (t.currency_id === targetCurr.id) continue;
    const key = `${t.currency_id}:${t.date}`;
    if (!uniquePairs.has(key)) {
      uniquePairs.set(key, { currencyId: t.currency_id, date: t.date });
    }
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
      const rate = row.from_currency_id === row.from_id
        ? parseFloat(row.rate)
        : 1.0 / parseFloat(row.rate);
      rateMap.set(key, rate);
    }
  }

  // Convert transactions synchronously using rate map
  const convertedTransactions = transactions.map(t => {
    const rate = t.currency_id === targetCurr.id
      ? 1.0
      : rateMap.get(`${t.currency_id}:${t.date}`) ?? null;

    return {
      id: t.id,
      date: t.date,
      description: t.description,
      originalAmount: parseFloat(t.amount),
      originalCurrency: t.currency_code,
      type: t.type,
      convertedAmount: rate ? parseFloat(t.amount) * rate : null,
      exchangeRate: rate,
      category: t.category_name,
      paymentMethod: t.payment_method,
      createdBy: {
        id: t.created_by_id,
        name: t.created_by_name,
      },
    };
  });

  // Aggregate by category (expenses only)
  const categoryTotals = {};
  // Aggregate by month
  const monthlyTotals = {};
  // Aggregate by user
  const userTotals = {};
  // Income vs expense
  let totalIncome = 0;
  let totalExpense = 0;
  // Monthly cash flow
  const monthlyCashFlow = {};

  convertedTransactions.forEach((t) => {
    const amount = t.convertedAmount || 0;
    const month = t.date.substring(0, 7);

    if (t.type === 'income') {
      totalIncome += amount;
      if (!monthlyCashFlow[month]) monthlyCashFlow[month] = { income: 0, expense: 0 };
      monthlyCashFlow[month].income += amount;
    } else {
      totalExpense += amount;
      if (!monthlyCashFlow[month]) monthlyCashFlow[month] = { income: 0, expense: 0 };
      monthlyCashFlow[month].expense += amount;

      // Category totals for expenses only
      const cat = t.category || 'Uncategorized';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
    }

    // By month (net)
    monthlyTotals[month] = (monthlyTotals[month] || 0) + (t.type === 'income' ? amount : -amount);

    // By user
    const userName = t.createdBy.name;
    userTotals[userName] = (userTotals[userName] || 0) + amount;
  });

  return {
    body: {
      success: true,
      walletId: parseInt(walletId),
      targetCurrency,
      transactions: convertedTransactions,
      summary: {
        totalTransactions: convertedTransactions.length,
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
