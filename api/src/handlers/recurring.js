import { checkWalletAccess } from './wallets.js';

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];

/**
 * Calculate the next due date given a frequency and current date.
 */
export function calculateNextDueDate(currentDate, frequency) {
  const d = new Date(currentDate + 'T00:00:00Z');
  const origDay = d.getUTCDate();

  switch (frequency) {
    case 'daily': d.setUTCDate(origDay + 1); break;
    case 'weekly': d.setUTCDate(origDay + 7); break;
    case 'biweekly': d.setUTCDate(origDay + 14); break;
    case 'monthly': {
      // Advance month, then clamp day to end-of-month if overflow occurred
      // e.g. Jan 31 → setMonth(1) → Mar 3 → clamp to Feb 28
      d.setUTCMonth(d.getUTCMonth() + 1);
      if (d.getUTCDate() !== origDay) {
        // Overflow: go back to last day of previous month
        d.setUTCDate(0);
      }
      break;
    }
    case 'yearly': {
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      // Handle Feb 29 → Feb 28 in non-leap years
      if (d.getUTCDate() !== origDay) {
        d.setUTCDate(0);
      }
      break;
    }
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
    LIMIT 200
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
  const updates = [];

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
    const deactivate = !!(r.end_date && nextDue > r.end_date);
    updates.push({ id: r.id, nextDue, deactivate });

    processed++;
  }

  // Batch UPDATE all recurring entries at once
  if (updates.length > 0) {
    const ids = updates.map(u => u.id);
    const nextDues = updates.map(u => u.nextDue);
    const actives = updates.map(u => !u.deactivate);

    await sql`
      UPDATE recurring_transactions AS rt SET
        next_due_date = u.next_due::date,
        is_active = u.active
      FROM (SELECT
        unnest(${ids}::int[]) AS id,
        unnest(${nextDues}::text[]) AS next_due,
        unnest(${actives}::boolean[]) AS active
      ) u WHERE rt.id = u.id
    `;
  }

  return processed;
}
