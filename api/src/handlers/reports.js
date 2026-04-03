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

  // Convert each transaction to target currency
  const convertedTransactions = await Promise.all(
    transactions.map(async (t) => {
      const rate = await getRate(sql, t.currency_id, targetCurr.id, t.date);
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
    })
  );

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

/**
 * Get exchange rate between two currencies for a given date.
 * Falls back to inverse rate if direct rate not found.
 */
async function getRate(sql, fromCurrencyId, toCurrencyId, date) {
  if (fromCurrencyId === toCurrencyId) return 1.0;

  const [rate] = await sql`
    SELECT rate FROM exchange_rates
    WHERE from_currency_id = ${fromCurrencyId}
      AND to_currency_id = ${toCurrencyId}
      AND effective_date <= ${date}
    ORDER BY effective_date DESC
    LIMIT 1
  `;

  if (rate) return parseFloat(rate.rate);

  // Try inverse
  const [inverseRate] = await sql`
    SELECT rate FROM exchange_rates
    WHERE from_currency_id = ${toCurrencyId}
      AND to_currency_id = ${fromCurrencyId}
      AND effective_date <= ${date}
    ORDER BY effective_date DESC
    LIMIT 1
  `;

  return inverseRate ? 1.0 / parseFloat(inverseRate.rate) : null;
}
