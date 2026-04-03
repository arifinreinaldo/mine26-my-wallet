/**
 * Check if a wallet exists and if a user is a member.
 * Returns { exists, role } where role is null if not a member.
 */
export async function checkWalletAccess(sql, walletId, userId) {
  const [wallet] = await sql`
    SELECT id FROM wallets WHERE id = ${walletId}
  `;
  if (!wallet) return { exists: false, role: null };

  const [membership] = await sql`
    SELECT role FROM wallet_users
    WHERE wallet_id = ${walletId} AND user_id = ${userId}
  `;
  return { exists: true, role: membership?.role || null };
}

/**
 * Create a new wallet. The creator (authenticated user) is automatically added as owner.
 */
export async function handleCreateWallet(sql, body, authUserId) {
  const { name, description, defaultCurrencyCode, startingBalance } = body;

  if (!name) {
    return {
      status: 400,
      body: { success: false, message: 'name is required' },
    };
  }

  let defaultCurrencyId = null;
  if (defaultCurrencyCode) {
    const [curr] = await sql`
      SELECT id FROM currencies WHERE code = ${defaultCurrencyCode}
    `;
    defaultCurrencyId = curr?.id || null;
  }

  const balance = typeof startingBalance === 'number' ? startingBalance : 0;

  const [wallet] = await sql`
    INSERT INTO wallets (name, description, default_currency_id, created_by_user_id, starting_balance)
    VALUES (${name}, ${description || null}, ${defaultCurrencyId}, ${authUserId}, ${balance})
    RETURNING id, name, created_at
  `;

  // Add creator as owner
  await sql`
    INSERT INTO wallet_users (wallet_id, user_id, role)
    VALUES (${wallet.id}, ${authUserId}, 'owner')
  `;

  return {
    body: {
      success: true,
      wallet: {
        id: wallet.id,
        name: wallet.name,
        startingBalance: balance,
        createdAt: wallet.created_at,
      },
    },
  };
}

/**
 * List wallets the authenticated user belongs to
 */
export async function handleGetWallets(sql, authUserId) {
  const wallets = await sql`
    SELECT
      w.id,
      w.name,
      w.description,
      w.starting_balance,
      w.default_currency_id,
      c.code AS default_currency,
      wu.role AS my_role,
      w.created_at,
      u.name AS created_by_name,
      (SELECT COUNT(*) FROM wallet_users WHERE wallet_id = w.id) AS member_count
    FROM wallets w
    JOIN wallet_users wu ON wu.wallet_id = w.id AND wu.user_id = ${authUserId}
    LEFT JOIN currencies c ON w.default_currency_id = c.id
    LEFT JOIN users u ON w.created_by_user_id = u.id
    ORDER BY w.created_at DESC
  `;

  // Compute balance per wallet, converting cross-currency transactions
  const results = await Promise.all(wallets.map(async (w) => {
    let transactionNet = 0;

    if (w.default_currency_id) {
      // Get all transactions grouped by currency
      const txByCurrency = await sql`
        SELECT
          t.currency_id,
          SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END) AS net
        FROM transactions t
        WHERE t.wallet_id = ${w.id}
        GROUP BY t.currency_id
      `;

      for (const row of txByCurrency) {
        const net = parseFloat(row.net);
        if (row.currency_id === w.default_currency_id) {
          transactionNet += net;
        } else {
          // Convert to wallet's default currency using latest rate
          const rate = await getLatestRate(sql, row.currency_id, w.default_currency_id);
          transactionNet += rate ? net * rate : net;
        }
      }
    }

    return {
      id: w.id,
      name: w.name,
      description: w.description,
      defaultCurrency: w.default_currency,
      startingBalance: parseFloat(w.starting_balance),
      currentBalance: parseFloat(w.starting_balance) + transactionNet,
      myRole: w.my_role,
      createdByName: w.created_by_name,
      memberCount: parseInt(w.member_count),
      createdAt: w.created_at,
    };
  }));

  return {
    body: { success: true, wallets: results },
  };
}

/**
 * Get the latest exchange rate between two currencies.
 * Falls back to inverse rate if direct not found.
 */
async function getLatestRate(sql, fromCurrencyId, toCurrencyId) {
  if (fromCurrencyId === toCurrencyId) return 1.0;

  const [rate] = await sql`
    SELECT rate FROM exchange_rates
    WHERE from_currency_id = ${fromCurrencyId} AND to_currency_id = ${toCurrencyId}
    ORDER BY effective_date DESC LIMIT 1
  `;
  if (rate) return parseFloat(rate.rate);

  const [inverse] = await sql`
    SELECT rate FROM exchange_rates
    WHERE from_currency_id = ${toCurrencyId} AND to_currency_id = ${fromCurrencyId}
    ORDER BY effective_date DESC LIMIT 1
  `;
  return inverse ? 1.0 / parseFloat(inverse.rate) : null;
}

/**
 * Edit a wallet (owner only)
 */
export async function handleEditWallet(sql, walletId, body, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (access.role !== 'owner') {
    return { status: 403, body: { success: false, message: 'Only owners can edit wallets' } };
  }

  const { name, description, defaultCurrencyCode, startingBalance } = body;

  let defaultCurrencyId = undefined;
  if (defaultCurrencyCode) {
    const [curr] = await sql`SELECT id FROM currencies WHERE code = ${defaultCurrencyCode}`;
    if (!curr) {
      return { status: 400, body: { success: false, message: 'Invalid currency code' } };
    }
    defaultCurrencyId = curr.id;
  }

  const hasName = 'name' in body;
  const hasDesc = 'description' in body;
  const hasCurrency = defaultCurrencyId !== undefined;
  const hasBalance = typeof startingBalance === 'number';

  const [updated] = await sql`
    UPDATE wallets SET
      name = CASE WHEN ${hasName} THEN ${name} ELSE name END,
      description = CASE WHEN ${hasDesc} THEN ${description} ELSE description END,
      default_currency_id = CASE WHEN ${hasCurrency} THEN ${defaultCurrencyId} ELSE default_currency_id END,
      starting_balance = CASE WHEN ${hasBalance} THEN ${startingBalance} ELSE starting_balance END
    WHERE id = ${walletId}
    RETURNING id, name
  `;

  return {
    body: { success: true, message: 'Wallet updated', wallet: { id: updated.id, name: updated.name } },
  };
}

/**
 * Delete a wallet (owner only)
 */
export async function handleDeleteWallet(sql, walletId, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (access.role !== 'owner') {
    return { status: 403, body: { success: false, message: 'Only owners can delete wallets' } };
  }

  await sql`DELETE FROM wallets WHERE id = ${walletId}`;

  return {
    body: { success: true, message: 'Wallet deleted' },
  };
}

/**
 * Get all members of a wallet (requires membership)
 */
export async function handleGetWalletMembers(sql, walletId, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }

  const members = await sql`
    SELECT
      u.id,
      u.name,
      u.email,
      wu.role,
      wu.joined_at
    FROM wallet_users wu
    JOIN users u ON wu.user_id = u.id
    WHERE wu.wallet_id = ${walletId}
    ORDER BY wu.joined_at
  `;

  return {
    body: {
      success: true,
      walletId: parseInt(walletId),
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    },
  };
}

/**
 * Add a user to a wallet with a role (requires owner or editor role)
 */
export async function handleAddWalletMember(sql, walletId, body, authUserId) {
  const { userId, role } = body;

  if (!userId) {
    return {
      status: 400,
      body: { success: false, message: 'userId is required' },
    };
  }

  // Check requester has permission to add members
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role || access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Only owners and editors can add members' } };
  }
  const requesterRole = access.role;

  const validRoles = ['owner', 'editor', 'viewer'];
  const assignRole = validRoles.includes(role) ? role : 'editor';

  // Only owners can add other owners
  if (assignRole === 'owner' && requesterRole !== 'owner') {
    return {
      status: 403,
      body: { success: false, message: 'Only owners can assign the owner role' },
    };
  }

  // Check user exists
  const [user] = await sql`SELECT id, name FROM users WHERE id = ${userId}`;
  if (!user) {
    return {
      status: 404,
      body: { success: false, message: 'User not found' },
    };
  }

  // Check not already a member
  const [existing] = await sql`
    SELECT id FROM wallet_users
    WHERE wallet_id = ${walletId} AND user_id = ${userId}
  `;
  if (existing) {
    return {
      status: 409,
      body: { success: false, message: 'User is already a member of this wallet' },
    };
  }

  await sql`
    INSERT INTO wallet_users (wallet_id, user_id, role)
    VALUES (${walletId}, ${userId}, ${assignRole})
  `;

  return {
    body: {
      success: true,
      message: `${user.name} added as ${assignRole}`,
    },
  };
}

/**
 * Remove a user from a wallet (requires owner role)
 */
export async function handleRemoveWalletMember(sql, walletId, userId, authUserId) {
  // Check requester is an owner
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (access.role !== 'owner') {
    return { status: 403, body: { success: false, message: 'Only owners can remove members' } };
  }

  // Prevent removing the last owner
  const [targetMembership] = await sql`
    SELECT role FROM wallet_users
    WHERE wallet_id = ${walletId} AND user_id = ${userId}
  `;

  if (!targetMembership) {
    return {
      status: 404,
      body: { success: false, message: 'Member not found in this wallet' },
    };
  }

  if (targetMembership.role === 'owner') {
    const [ownerCount] = await sql`
      SELECT COUNT(*) AS count FROM wallet_users
      WHERE wallet_id = ${walletId} AND role = 'owner'
    `;
    if (parseInt(ownerCount.count) <= 1) {
      return {
        status: 400,
        body: { success: false, message: 'Cannot remove the last owner of a wallet' },
      };
    }
  }

  await sql`
    DELETE FROM wallet_users
    WHERE wallet_id = ${walletId} AND user_id = ${userId}
  `;

  return {
    body: { success: true, message: 'Member removed' },
  };
}
