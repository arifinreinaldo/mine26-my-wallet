/**
 * Add a transaction to a wallet
 */
export async function handleAddTransaction(sql, walletId, body, authUserId) {
  const { date, description, amount, currencyCode, categoryId, paymentMethod, notes } = body;

  if (!date || amount == null || !currencyCode) {
    return {
      status: 400,
      body: { success: false, message: 'date, amount, and currencyCode are required' },
    };
  }

  // Verify user is a member with editor or owner role
  const [membership] = await sql`
    SELECT role FROM wallet_users
    WHERE wallet_id = ${walletId} AND user_id = ${authUserId}
  `;

  if (!membership) {
    return {
      status: 403,
      body: { success: false, message: 'You are not a member of this wallet' },
    };
  }

  if (membership.role === 'viewer') {
    return {
      status: 403,
      body: { success: false, message: 'Viewers cannot add transactions' },
    };
  }

  // Resolve currency
  const [currency] = await sql`
    SELECT id FROM currencies WHERE code = ${currencyCode}
  `;

  if (!currency) {
    return {
      status: 400,
      body: { success: false, message: 'Invalid currency code' },
    };
  }

  const [transaction] = await sql`
    INSERT INTO transactions
    (wallet_id, date, description, amount, currency_id, category_id, payment_method, notes, created_by_user_id)
    VALUES (
      ${walletId}, ${date}, ${description || null}, ${amount},
      ${currency.id}, ${categoryId || null}, ${paymentMethod || null},
      ${notes || null}, ${authUserId}
    )
    RETURNING id, created_at
  `;

  const [user] = await sql`SELECT name FROM users WHERE id = ${authUserId}`;

  return {
    body: {
      success: true,
      transactionId: transaction.id,
      createdBy: {
        id: authUserId,
        name: user.name,
      },
      createdAt: transaction.created_at,
    },
  };
}

/**
 * List transactions for a wallet (requires membership)
 */
export async function handleGetTransactions(sql, walletId, searchParams, authUserId) {
  // Verify user is a member
  const [membership] = await sql`
    SELECT role FROM wallet_users
    WHERE wallet_id = ${walletId} AND user_id = ${authUserId}
  `;

  if (!membership) {
    return {
      status: 403,
      body: { success: false, message: 'You are not a member of this wallet' },
    };
  }

  const fromDate = searchParams.get('from');
  const toDate = searchParams.get('to');
  const createdBy = searchParams.get('createdBy');

  const transactions = await sql`
    SELECT
      t.id,
      t.date,
      t.description,
      t.amount,
      c.code AS currency,
      c.symbol AS currency_symbol,
      cat.name AS category,
      t.payment_method,
      t.notes,
      u.id AS created_by_id,
      u.name AS created_by_name,
      t.created_at
    FROM transactions t
    JOIN currencies c ON t.currency_id = c.id
    LEFT JOIN categories cat ON t.category_id = cat.id
    JOIN users u ON t.created_by_user_id = u.id
    WHERE t.wallet_id = ${walletId}
      AND (${fromDate}::date IS NULL OR t.date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR t.date <= ${toDate}::date)
      AND (${createdBy}::integer IS NULL OR t.created_by_user_id = ${createdBy}::integer)
    ORDER BY t.date DESC, t.created_at DESC
  `;

  return {
    body: {
      success: true,
      walletId: parseInt(walletId),
      transactions: transactions.map((t) => ({
        id: t.id,
        date: t.date,
        description: t.description,
        amount: parseFloat(t.amount),
        currency: t.currency,
        currencySymbol: t.currency_symbol,
        category: t.category,
        paymentMethod: t.payment_method,
        notes: t.notes,
        createdBy: {
          id: t.created_by_id,
          name: t.created_by_name,
        },
        createdAt: t.created_at,
      })),
    },
  };
}
