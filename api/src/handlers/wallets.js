/**
 * Check if a wallet exists and if a user is a member.
 * Returns { exists, role } where role is null if not a member.
 */
export async function checkWalletAccess(sql, walletId, userId) {
  const [row] = await sql`
    SELECT w.id, wu.role FROM wallets w
    LEFT JOIN wallet_users wu ON wu.wallet_id = w.id AND wu.user_id = ${userId}
    WHERE w.id = ${walletId}
  `;
  if (!row) return { exists: false, role: null };
  return { exists: true, role: row.role || null };
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
 * List wallets the authenticated user belongs to.
 * Computes currentBalance by converting cross-currency transactions using latest exchange rates.
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
      COALESCE(mc.member_count, 0) AS member_count
    FROM wallets w
    JOIN wallet_users wu ON wu.wallet_id = w.id AND wu.user_id = ${authUserId}
    LEFT JOIN currencies c ON w.default_currency_id = c.id
    LEFT JOIN users u ON w.created_by_user_id = u.id
    LEFT JOIN (
      SELECT wallet_id, COUNT(*) AS member_count
      FROM wallet_users GROUP BY wallet_id
    ) mc ON mc.wallet_id = w.id
    ORDER BY w.created_at DESC
  `;

  if (wallets.length === 0) {
    return { body: { success: true, wallets: [] } };
  }

  // Batch-fetch transaction nets for ALL wallets in 1 query
  const walletIds = wallets.map(w => w.id);
  const txNets = await sql`
    SELECT wallet_id, currency_id,
      SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS net
    FROM transactions
    WHERE wallet_id = ANY(${walletIds})
    GROUP BY wallet_id, currency_id
  `;

  // Build a lookup: walletId -> [{ currencyId, net }]
  const netsByWallet = new Map();
  for (const row of txNets) {
    if (!netsByWallet.has(row.wallet_id)) netsByWallet.set(row.wallet_id, []);
    netsByWallet.get(row.wallet_id).push({
      currencyId: row.currency_id,
      net: parseFloat(row.net),
    });
  }

  // Collect unique currency pairs needing conversion
  const ratePairsSet = new Set();
  for (const row of txNets) {
    const wallet = wallets.find(w => w.id === row.wallet_id);
    if (wallet?.default_currency_id && row.currency_id !== wallet.default_currency_id) {
      ratePairsSet.add(`${row.currency_id}:${wallet.default_currency_id}`);
    }
  }

  // Batch-fetch all latest rates in 1 query
  const rateMap = new Map(); // "fromId:toId" -> rate
  if (ratePairsSet.size > 0) {
    const fromIds = [...ratePairsSet].map(p => parseInt(p.split(':')[0]));
    const toIds = [...ratePairsSet].map(p => parseInt(p.split(':')[1]));

    const rateRows = await sql`
      SELECT sub.from_id, sub.to_id, er.rate, er.from_currency_id, er.to_currency_id
      FROM (SELECT unnest(${fromIds}::int[]) AS from_id, unnest(${toIds}::int[]) AS to_id) sub
      LEFT JOIN LATERAL (
        SELECT rate, from_currency_id, to_currency_id FROM exchange_rates
        WHERE ((from_currency_id = sub.from_id AND to_currency_id = sub.to_id)
            OR (from_currency_id = sub.to_id AND to_currency_id = sub.from_id))
        ORDER BY effective_date DESC LIMIT 1
      ) er ON true
    `;

    for (const row of rateRows) {
      const key = `${row.from_id}:${row.to_id}`;
      if (!row.rate) { rateMap.set(key, null); continue; }
      const rate = row.from_currency_id === row.from_id
        ? parseFloat(row.rate)
        : 1.0 / parseFloat(row.rate);
      rateMap.set(key, rate);
    }
  }

  // Compute balances synchronously
  const results = wallets.map(w => {
    let transactionNet = 0;
    const entries = netsByWallet.get(w.id) || [];

    for (const entry of entries) {
      if (!w.default_currency_id || entry.currencyId === w.default_currency_id) {
        transactionNet += entry.net;
      } else {
        const rate = rateMap.get(`${entry.currencyId}:${w.default_currency_id}`);
        transactionNet += rate ? entry.net * rate : entry.net;
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
  });

  return {
    body: { success: true, wallets: results },
  };
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
