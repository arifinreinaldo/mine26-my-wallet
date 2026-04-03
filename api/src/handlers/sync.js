import { checkWalletAccess } from './wallets.js';

const MAX_SYNC_BATCH_SIZE = 500;
const MAX_CLOCK_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Push sync — client sends offline changes to server.
 * Handles create (upsert), update (LWW), and delete (soft delete).
 */
export async function handlePushSync(sql, walletId, body, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role || access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Viewers cannot sync changes' } };
  }

  const { changes } = body;
  if (!Array.isArray(changes) || changes.length === 0) {
    return { status: 400, body: { success: false, message: 'changes array is required' } };
  }

  if (changes.length > MAX_SYNC_BATCH_SIZE) {
    return {
      status: 400,
      body: { success: false, message: `Maximum ${MAX_SYNC_BATCH_SIZE} changes per sync` },
    };
  }

  // Pre-resolve all currency codes used in creates AND updates
  const allCurrencyCodes = [...new Set(
    changes
      .filter(c => (c.operation === 'create' || c.operation === 'update') && c.data?.currencyCode)
      .map(c => c.data.currencyCode)
  )];

  const currencyMap = {};
  if (allCurrencyCodes.length > 0) {
    const currencies = await sql`
      SELECT id, code FROM currencies WHERE code = ANY(${allCurrencyCodes})
    `;
    for (const c of currencies) currencyMap[c.code] = c.id;
  }

  const results = [];
  const errors = [];

  for (const change of changes) {
    const { clientId, operation, data, clientUpdatedAt } = change;

    if (!clientId || !operation) {
      errors.push({ clientId, error: 'clientId and operation are required' });
      continue;
    }

    // Reject timestamps too far in the future (clock skew protection)
    if (clientUpdatedAt) {
      const clientTime = new Date(clientUpdatedAt).getTime();
      if (clientTime > Date.now() + MAX_CLOCK_DRIFT_MS) {
        errors.push({ clientId, error: 'clientUpdatedAt is too far in the future' });
        continue;
      }
    }

    try {
      if (operation === 'create') {
        const result = await syncCreate(sql, walletId, clientId, data, clientUpdatedAt, authUserId, currencyMap);
        results.push(result);
      } else if (operation === 'update') {
        const result = await syncUpdate(sql, walletId, clientId, data, clientUpdatedAt, currencyMap);
        results.push(result);
      } else if (operation === 'delete') {
        const result = await syncDelete(sql, walletId, clientId);
        results.push(result);
      } else {
        errors.push({ clientId, error: `Unknown operation: ${operation}` });
      }
    } catch (err) {
      errors.push({ clientId, error: err.message });
    }
  }

  return {
    body: { success: true, results, errors },
  };
}

/**
 * Create or upsert a transaction via sync.
 * Uses ON CONFLICT (client_id) for idempotency.
 * Does NOT resurrect soft-deleted transactions — those conflicts are reported.
 */
async function syncCreate(sql, walletId, clientId, data, clientUpdatedAt, authUserId, currencyMap) {
  const { date, description, amount, type, currencyCode, categoryId, paymentMethod, notes } = data || {};

  if (!date || amount == null || !currencyCode) {
    return { clientId, status: 'error', error: 'date, amount, and currencyCode are required' };
  }

  const currencyId = currencyMap[currencyCode];
  if (!currencyId) {
    return { clientId, status: 'error', error: `Invalid currency code: ${currencyCode}` };
  }

  const txType = type === 'income' ? 'income' : 'expense';
  const updatedAt = clientUpdatedAt || new Date().toISOString();

  // Check if a soft-deleted transaction with this client_id exists
  const [existing] = await sql`
    SELECT id, deleted_at FROM transactions WHERE client_id = ${clientId}::uuid
  `;

  if (existing && existing.deleted_at) {
    return { clientId, status: 'conflict', error: 'Transaction was deleted', serverId: existing.id };
  }

  const [row] = await sql`
    INSERT INTO transactions
    (client_id, wallet_id, date, description, amount, type, currency_id, category_id,
     payment_method, notes, created_by_user_id, updated_at)
    VALUES (
      ${clientId}::uuid, ${walletId}, ${date}, ${description || null}, ${amount}, ${txType},
      ${currencyId}, ${categoryId || null}, ${paymentMethod || null},
      ${notes || null}, ${authUserId}, ${updatedAt}
    )
    ON CONFLICT (client_id) DO UPDATE SET
      date = CASE WHEN ${updatedAt}::timestamptz > transactions.updated_at
        THEN EXCLUDED.date ELSE transactions.date END,
      description = CASE WHEN ${updatedAt}::timestamptz > transactions.updated_at
        THEN EXCLUDED.description ELSE transactions.description END,
      amount = CASE WHEN ${updatedAt}::timestamptz > transactions.updated_at
        THEN EXCLUDED.amount ELSE transactions.amount END,
      type = CASE WHEN ${updatedAt}::timestamptz > transactions.updated_at
        THEN EXCLUDED.type ELSE transactions.type END,
      currency_id = CASE WHEN ${updatedAt}::timestamptz > transactions.updated_at
        THEN EXCLUDED.currency_id ELSE transactions.currency_id END,
      category_id = CASE WHEN ${updatedAt}::timestamptz > transactions.updated_at
        THEN EXCLUDED.category_id ELSE transactions.category_id END,
      payment_method = CASE WHEN ${updatedAt}::timestamptz > transactions.updated_at
        THEN EXCLUDED.payment_method ELSE transactions.payment_method END,
      notes = CASE WHEN ${updatedAt}::timestamptz > transactions.updated_at
        THEN EXCLUDED.notes ELSE transactions.notes END,
      updated_at = CASE WHEN ${updatedAt}::timestamptz > transactions.updated_at
        THEN EXCLUDED.updated_at ELSE transactions.updated_at END
    WHERE transactions.deleted_at IS NULL
    RETURNING id
  `;

  return { clientId, status: 'created', serverId: row.id };
}

/**
 * Update a transaction via sync (last-write-wins).
 */
async function syncUpdate(sql, walletId, clientId, data, clientUpdatedAt, currencyMap) {
  if (!data || !clientUpdatedAt) {
    return { clientId, status: 'error', error: 'data and clientUpdatedAt are required' };
  }

  const { date, description, amount, type, currencyCode, categoryId, paymentMethod, notes } = data;

  // Resolve currency using pre-batched map
  let currencyId = undefined;
  if (currencyCode) {
    currencyId = currencyMap[currencyCode];
    if (!currencyId) return { clientId, status: 'error', error: 'Invalid currency code' };
  }

  const txType = type === 'income' ? 'income' : type === 'expense' ? 'expense' : undefined;

  const hasDate = 'date' in data;
  const hasDesc = 'description' in data;
  const hasAmount = 'amount' in data;
  const hasType = txType !== undefined;
  const hasCurrency = currencyId !== undefined;
  const hasCategoryId = 'categoryId' in data;
  const hasPayment = 'paymentMethod' in data;
  const hasNotes = 'notes' in data;

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
    WHERE client_id = ${clientId}::uuid
      AND wallet_id = ${walletId}
      AND deleted_at IS NULL
      AND updated_at < ${clientUpdatedAt}::timestamptz
    RETURNING id
  `;

  if (!updated) {
    const [exists] = await sql`
      SELECT id, updated_at, deleted_at FROM transactions
      WHERE client_id = ${clientId}::uuid AND wallet_id = ${walletId}
    `;
    if (!exists) return { clientId, status: 'error', error: 'Transaction not found' };
    if (exists.deleted_at) return { clientId, status: 'error', error: 'Transaction was deleted' };
    return { clientId, status: 'conflict', serverId: exists.id, serverUpdatedAt: exists.updated_at };
  }

  return { clientId, status: 'updated', serverId: updated.id };
}

/**
 * Soft-delete a transaction via sync.
 */
async function syncDelete(sql, walletId, clientId) {
  const [deleted] = await sql`
    UPDATE transactions SET deleted_at = NOW(), updated_at = NOW()
    WHERE client_id = ${clientId}::uuid
      AND wallet_id = ${walletId}
      AND deleted_at IS NULL
    RETURNING id
  `;

  if (!deleted) {
    const [exists] = await sql`
      SELECT id FROM transactions
      WHERE client_id = ${clientId}::uuid AND wallet_id = ${walletId}
    `;
    if (!exists) return { clientId, status: 'error', error: 'Transaction not found' };
    return { clientId, status: 'already_deleted' };
  }

  return { clientId, status: 'deleted', serverId: deleted.id };
}

/**
 * Pull sync — returns all changes since a given timestamp.
 * Includes soft-deleted records so client can remove them locally.
 * Supports pagination via limit parameter.
 */
export async function handlePullSync(sql, walletId, searchParams, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }

  const since = searchParams.get('since');
  const limit = Math.min(parseInt(searchParams.get('limit')) || 500, 1000);

  // Get server timestamp BEFORE the query for consistency
  const [{ now: syncTimestamp }] = await sql`SELECT NOW() AS now`;

  let changes;
  if (since) {
    changes = await sql`
      SELECT
        t.id, t.client_id, t.date, t.description, t.amount, t.type,
        c.code AS currency_code, t.category_id,
        cat.name AS category_name,
        t.payment_method, t.notes,
        t.created_by_user_id, u.name AS created_by_name,
        t.created_at, t.updated_at, t.deleted_at
      FROM transactions t
      JOIN currencies c ON t.currency_id = c.id
      LEFT JOIN categories cat ON t.category_id = cat.id
      JOIN users u ON t.created_by_user_id = u.id
      WHERE t.wallet_id = ${walletId}
        AND t.updated_at > ${since}::timestamptz
      ORDER BY t.updated_at ASC
      LIMIT ${limit + 1}
    `;
  } else {
    // Full sync — return all transactions
    changes = await sql`
      SELECT
        t.id, t.client_id, t.date, t.description, t.amount, t.type,
        c.code AS currency_code, t.category_id,
        cat.name AS category_name,
        t.payment_method, t.notes,
        t.created_by_user_id, u.name AS created_by_name,
        t.created_at, t.updated_at, t.deleted_at
      FROM transactions t
      JOIN currencies c ON t.currency_id = c.id
      LEFT JOIN categories cat ON t.category_id = cat.id
      JOIN users u ON t.created_by_user_id = u.id
      WHERE t.wallet_id = ${walletId}
      ORDER BY t.updated_at ASC
      LIMIT ${limit + 1}
    `;
  }

  // Check if there are more results (pagination)
  const hasMore = changes.length > limit;
  if (hasMore) changes = changes.slice(0, limit);

  return {
    body: {
      success: true,
      walletId: parseInt(walletId),
      changes: changes.map(t => ({
        serverId: t.id,
        clientId: t.client_id,
        date: t.date,
        description: t.description,
        amount: parseFloat(t.amount),
        type: t.type,
        currencyCode: t.currency_code,
        categoryId: t.category_id,
        category: t.category_name,
        paymentMethod: t.payment_method,
        notes: t.notes,
        createdBy: {
          id: t.created_by_user_id,
          name: t.created_by_name,
        },
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        deletedAt: t.deleted_at,
      })),
      hasMore,
      syncTimestamp: hasMore ? null : syncTimestamp,
    },
  };
}
