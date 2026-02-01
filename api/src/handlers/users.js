/**
 * Get all users
 */
export async function handleGetUsers(sql) {
  const users = await sql`
    SELECT
      u.id,
      u.name,
      u.email,
      u.username,
      u.created_at,
      (SELECT COUNT(*) FROM wallet_users WHERE user_id = u.id) AS wallet_count
    FROM users u
    ORDER BY u.created_at DESC
  `;

  return {
    body: {
      success: true,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        username: u.username,
        walletCount: parseInt(u.wallet_count),
        createdAt: u.created_at,
      })),
    },
  };
}

/**
 * Get a single user by ID, including their wallets
 */
export async function handleGetUser(sql, userId) {
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
