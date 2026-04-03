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
  const { name, description, defaultCurrencyCode } = body;

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

  const [wallet] = await sql`
    INSERT INTO wallets (name, description, default_currency_id, created_by_user_id)
    VALUES (${name}, ${description || null}, ${defaultCurrencyId}, ${authUserId})
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

  return {
    body: {
      success: true,
      wallets: wallets.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        defaultCurrency: w.default_currency,
        myRole: w.my_role,
        createdByName: w.created_by_name,
        memberCount: parseInt(w.member_count),
        createdAt: w.created_at,
      })),
    },
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
