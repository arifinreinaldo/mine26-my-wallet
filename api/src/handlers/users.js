/**
 * Get current authenticated user's profile with their wallets
 */
export async function handleGetMe(sql, userId) {
  const [user] = await sql`
    SELECT id, name, email, username, created_at
    FROM users WHERE id = ${userId}
  `;

  if (!user) {
    return {
      status: 404,
      body: { success: false, message: 'User not found' },
    };
  }

  const wallets = await sql`
    SELECT
      w.id,
      w.name,
      w.description,
      wu.role,
      wu.joined_at
    FROM wallet_users wu
    JOIN wallets w ON wu.wallet_id = w.id
    WHERE wu.user_id = ${userId}
    ORDER BY wu.joined_at DESC
  `;

  return {
    body: {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        createdAt: user.created_at,
        wallets: wallets.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          role: w.role,
          joinedAt: w.joined_at,
        })),
      },
    },
  };
}

/**
 * Search for a user by username (for adding wallet members)
 */
export async function handleSearchUser(sql, username) {
  if (!username) {
    return {
      status: 400,
      body: { success: false, message: 'username query parameter is required' },
    };
  }

  const [user] = await sql`
    SELECT id, name, username
    FROM users
    WHERE username = ${username} AND verified = true
  `;

  if (!user) {
    return {
      status: 404,
      body: { success: false, message: 'User not found' },
    };
  }

  return {
    body: {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
      },
    },
  };
}
