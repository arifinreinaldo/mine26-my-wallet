import { checkWalletAccess } from './wallets.js';

/**
 * Add a transaction to a wallet
 */
export async function handleAddTransaction(sql, walletId, body, authUserId) {
  const { date, description, amount, currencyCode, categoryId, paymentMethod, notes, type } = body;

  if (!date || amount == null || !currencyCode) {
    return {
      status: 400,
      body: { success: false, message: 'date, amount, and currencyCode are required' },
    };
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return {
      status: 400,
      body: { success: false, message: 'amount must be a positive number' },
    };
  }

  const txType = type === 'income' ? 'income' : 'expense';

  // Verify user is a member with editor or owner role
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }
  if (access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Viewers cannot add transactions' } };
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
    (wallet_id, date, description, amount, type, currency_id, category_id, payment_method, notes, created_by_user_id)
    VALUES (
      ${walletId}, ${date}, ${description || null}, ${amount}, ${txType},
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
      type: txType,
      createdBy: {
        id: authUserId,
        name: user.name,
      },
      createdAt: transaction.created_at,
    },
  };
}

/**
 * Edit a transaction (owner/editor who created it, or wallet owner)
 */
export async function handleEditTransaction(sql, walletId, transactionId, body, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }
  if (access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Viewers cannot edit transactions' } };
  }

  // Verify transaction exists and belongs to this wallet
  const [existing] = await sql`
    SELECT id, created_by_user_id FROM transactions
    WHERE id = ${transactionId} AND wallet_id = ${walletId} AND deleted_at IS NULL
  `;

  if (!existing) {
    return { status: 404, body: { success: false, message: 'Transaction not found' } };
  }

  // Only the creator or a wallet owner can edit
  if (existing.created_by_user_id !== authUserId && access.role !== 'owner') {
    return { status: 403, body: { success: false, message: 'You can only edit your own transactions' } };
  }

  const { date, description, amount, currencyCode, categoryId, paymentMethod, notes, type } = body;

  if (amount != null && (typeof amount !== 'number' || amount <= 0)) {
    return { status: 400, body: { success: false, message: 'amount must be a positive number' } };
  }

  // Resolve currency if provided
  let currencyId = undefined;
  if (currencyCode) {
    const [currency] = await sql`SELECT id FROM currencies WHERE code = ${currencyCode}`;
    if (!currency) {
      return { status: 400, body: { success: false, message: 'Invalid currency code' } };
    }
    currencyId = currency.id;
  }

  const txType = type === 'income' ? 'income' : type === 'expense' ? 'expense' : undefined;

  // Build update — only update fields that were explicitly provided
  const hasDate = 'date' in body;
  const hasDesc = 'description' in body;
  const hasAmount = 'amount' in body;
  const hasType = txType !== undefined;
  const hasCurrency = currencyId !== undefined;
  const hasCategoryId = 'categoryId' in body;
  const hasPayment = 'paymentMethod' in body;
  const hasNotes = 'notes' in body;

  const [updated] = await sql`
    UPDATE transactions SET
      date = CASE WHEN ${hasDate} THEN ${date}::date ELSE date END,
      description = CASE WHEN ${hasDesc} THEN ${description} ELSE description END,
      amount = CASE WHEN ${hasAmount} THEN ${amount} ELSE amount END,
      type = CASE WHEN ${hasType} THEN ${txType} ELSE type END,
      currency_id = CASE WHEN ${hasCurrency} THEN ${currencyId} ELSE currency_id END,
      category_id = CASE WHEN ${hasCategoryId} THEN ${categoryId} ELSE category_id END,
      payment_method = CASE WHEN ${hasPayment} THEN ${paymentMethod} ELSE payment_method END,
      notes = CASE WHEN ${hasNotes} THEN ${notes} ELSE notes END,
      updated_at = NOW()
    WHERE id = ${transactionId} AND wallet_id = ${walletId}
    RETURNING id
  `;

  return {
    body: { success: true, message: 'Transaction updated', transactionId: updated.id },
  };
}

/**
 * Delete a transaction (owner/editor who created it, or wallet owner)
 */
export async function handleDeleteTransaction(sql, walletId, transactionId, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }
  if (access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Viewers cannot delete transactions' } };
  }

  const [existing] = await sql`
    SELECT id, created_by_user_id FROM transactions
    WHERE id = ${transactionId} AND wallet_id = ${walletId} AND deleted_at IS NULL
  `;

  if (!existing) {
    return { status: 404, body: { success: false, message: 'Transaction not found' } };
  }

  if (existing.created_by_user_id !== authUserId && access.role !== 'owner') {
    return { status: 403, body: { success: false, message: 'You can only delete your own transactions' } };
  }

  await sql`
    UPDATE transactions SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${transactionId}
  `;

  return {
    body: { success: true, message: 'Transaction deleted' },
  };
}

/**
 * List transactions for a wallet (requires membership)
 */
export async function handleGetTransactions(sql, walletId, searchParams, authUserId) {
  // Verify user is a member
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }

  const fromDate = searchParams.get('from');
  const toDate = searchParams.get('to');
  const createdBy = searchParams.get('createdBy');
  const categoryId = searchParams.get('categoryId');
  const type = searchParams.get('type');
  const q = searchParams.get('q');
  const limit = Math.min(parseInt(searchParams.get('limit')) || 50, 200);
  const page = Math.max(parseInt(searchParams.get('page')) || 1, 1);
  const offset = (page - 1) * limit;

  const transactions = await sql`
    SELECT
      t.id,
      t.date,
      t.description,
      t.amount,
      t.type,
      c.code AS currency,
      c.symbol AS currency_symbol,
      cat.name AS category,
      cat.id AS category_id,
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
      AND t.deleted_at IS NULL
      AND (${fromDate}::date IS NULL OR t.date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR t.date <= ${toDate}::date)
      AND (${createdBy}::integer IS NULL OR t.created_by_user_id = ${createdBy}::integer)
      AND (${categoryId}::integer IS NULL OR t.category_id = ${categoryId}::integer)
      AND (${type}::text IS NULL OR t.type = ${type}::text)
      AND (${q}::text IS NULL OR t.description ILIKE '%' || ${q}::text || '%' OR t.notes ILIKE '%' || ${q}::text || '%')
    ORDER BY t.date DESC, t.created_at DESC
    LIMIT ${limit + 1} OFFSET ${offset}
  `;

  const hasMore = transactions.length > limit;
  const results = (hasMore ? transactions.slice(0, limit) : transactions);

  return {
    body: {
      success: true,
      walletId: parseInt(walletId),
      page,
      limit,
      hasMore,
      transactions: results.map((t) => ({
        id: t.id,
        date: t.date,
        description: t.description,
        amount: parseFloat(t.amount),
        type: t.type,
        currency: t.currency,
        currencySymbol: t.currency_symbol,
        category: t.category,
        categoryId: t.category_id,
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
