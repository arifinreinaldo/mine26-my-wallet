import { checkWalletAccess } from './wallets.js';

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];

/**
 * Calculate the next due date given a frequency and current date.
 */
function calculateNextDueDate(currentDate, frequency) {
  const d = new Date(currentDate);
  switch (frequency) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split('T')[0];
}

/**
 * Create a recurring transaction
 */
export async function handleCreateRecurring(sql, walletId, body, authUserId) {
  const { description, amount, type, currencyCode, categoryId, paymentMethod, notes, frequency, startDate, endDate } = body;

  if (!amount || !currencyCode || !frequency || !startDate) {
    return {
      status: 400,
      body: { success: false, message: 'amount, currencyCode, frequency, and startDate are required' },
    };
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return { status: 400, body: { success: false, message: 'amount must be a positive number' } };
  }

  if (!VALID_FREQUENCIES.includes(frequency)) {
    return {
      status: 400,
      body: { success: false, message: `frequency must be one of: ${VALID_FREQUENCIES.join(', ')}` },
    };
  }

  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role || access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Viewers cannot create recurring transactions' } };
  }

  const [currency] = await sql`SELECT id FROM currencies WHERE code = ${currencyCode}`;
  if (!currency) {
    return { status: 400, body: { success: false, message: 'Invalid currency code' } };
  }

  const txType = type === 'income' ? 'income' : 'expense';

  const [recurring] = await sql`
    INSERT INTO recurring_transactions
    (wallet_id, description, amount, type, currency_id, category_id, payment_method, notes,
     frequency, start_date, end_date, next_due_date, created_by_user_id)
    VALUES (
      ${walletId}, ${description || null}, ${amount}, ${txType},
      ${currency.id}, ${categoryId || null}, ${paymentMethod || null}, ${notes || null},
      ${frequency}, ${startDate}, ${endDate || null}, ${startDate}, ${authUserId}
    )
    RETURNING id, next_due_date, created_at
  `;

  return {
    body: {
      success: true,
      recurringTransaction: {
        id: recurring.id,
        nextDueDate: recurring.next_due_date,
        createdAt: recurring.created_at,
      },
    },
  };
}

/**
 * List recurring transactions for a wallet
 */
export async function handleGetRecurring(sql, walletId, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }

  const recurring = await sql`
    SELECT
      r.id, r.description, r.amount, r.type, r.frequency,
      c.code AS currency, r.category_id,
      cat.name AS category_name,
      r.payment_method, r.notes,
      r.start_date, r.end_date, r.next_due_date, r.is_active,
      u.id AS created_by_id, u.name AS created_by_name,
      r.created_at
    FROM recurring_transactions r
    JOIN currencies c ON r.currency_id = c.id
    LEFT JOIN categories cat ON r.category_id = cat.id
    JOIN users u ON r.created_by_user_id = u.id
    WHERE r.wallet_id = ${walletId}
    ORDER BY r.next_due_date ASC
  `;

  return {
    body: {
      success: true,
      walletId: parseInt(walletId),
      recurringTransactions: recurring.map((r) => ({
        id: r.id,
        description: r.description,
        amount: parseFloat(r.amount),
        type: r.type,
        currency: r.currency,
        category: r.category_name,
        frequency: r.frequency,
        paymentMethod: r.payment_method,
        notes: r.notes,
        startDate: r.start_date,
        endDate: r.end_date,
        nextDueDate: r.next_due_date,
        isActive: r.is_active,
        createdBy: { id: r.created_by_id, name: r.created_by_name },
        createdAt: r.created_at,
      })),
    },
  };
}

/**
 * Delete (deactivate) a recurring transaction
 */
export async function handleDeleteRecurring(sql, walletId, recurringId, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role || access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Insufficient permissions' } };
  }

  const [existing] = await sql`
    SELECT id, created_by_user_id FROM recurring_transactions
    WHERE id = ${recurringId} AND wallet_id = ${walletId}
  `;

  if (!existing) {
    return { status: 404, body: { success: false, message: 'Recurring transaction not found' } };
  }

  if (existing.created_by_user_id !== authUserId && access.role !== 'owner') {
    return { status: 403, body: { success: false, message: 'You can only delete your own recurring transactions' } };
  }

  await sql`
    UPDATE recurring_transactions SET is_active = false WHERE id = ${recurringId}
  `;

  return {
    body: { success: true, message: 'Recurring transaction deactivated' },
  };
}

/**
 * Process due recurring transactions — called by scheduled cron.
 * Creates actual transactions for any recurring entries whose next_due_date <= today.
 */
export async function processRecurringTransactions(sql) {
  const dueRecurring = await sql`
    SELECT * FROM recurring_transactions
    WHERE is_active = TRUE AND next_due_date <= CURRENT_DATE
      AND (end_date IS NULL OR next_due_date <= end_date)
  `;

  let processed = 0;

  for (const r of dueRecurring) {
    // Create the actual transaction
    await sql`
      INSERT INTO transactions
      (wallet_id, date, description, amount, type, currency_id, category_id, payment_method, notes, created_by_user_id)
      VALUES (
        ${r.wallet_id}, ${r.next_due_date}, ${r.description}, ${r.amount}, ${r.type},
        ${r.currency_id}, ${r.category_id}, ${r.payment_method},
        ${r.notes ? r.notes + ' (recurring)' : '(recurring)'}, ${r.created_by_user_id}
      )
    `;

    // Calculate next due date
    const nextDue = calculateNextDueDate(r.next_due_date, r.frequency);

    // Deactivate if past end_date
    if (r.end_date && nextDue > r.end_date) {
      await sql`UPDATE recurring_transactions SET is_active = false, next_due_date = ${nextDue} WHERE id = ${r.id}`;
    } else {
      await sql`UPDATE recurring_transactions SET next_due_date = ${nextDue} WHERE id = ${r.id}`;
    }

    processed++;
  }

  return processed;
}
