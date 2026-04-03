import { checkWalletAccess } from './wallets.js';

/**
 * List categories: global (seeded) + custom ones for a wallet
 */
export async function handleGetCategories(sql, searchParams, authUserId) {
  const walletId = searchParams.get('walletId');

  let categories;
  if (walletId) {
    // Global categories + wallet-specific custom ones
    categories = await sql`
      SELECT id, name, icon, color, wallet_id, parent_id
      FROM categories
      WHERE wallet_id IS NULL OR wallet_id = ${walletId}
      ORDER BY wallet_id NULLS FIRST, name
    `;
  } else {
    // Only global categories
    categories = await sql`
      SELECT id, name, icon, color, wallet_id, parent_id
      FROM categories
      WHERE wallet_id IS NULL
      ORDER BY name
    `;
  }

  return {
    body: {
      success: true,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        isCustom: c.wallet_id !== null,
        parentId: c.parent_id,
      })),
    },
  };
}

/**
 * Create a custom category for a wallet
 */
export async function handleCreateCategory(sql, body, authUserId) {
  const { name, icon, color, walletId, parentId } = body;

  if (!name) {
    return { status: 400, body: { success: false, message: 'name is required' } };
  }

  // If wallet-scoped, verify membership
  if (walletId) {
    const access = await checkWalletAccess(sql, walletId, authUserId);
    if (!access.exists) {
      return { status: 404, body: { success: false, message: 'Wallet not found' } };
    }
    if (!access.role || access.role === 'viewer') {
      return { status: 403, body: { success: false, message: 'Viewers cannot create categories' } };
    }
  }

  const [category] = await sql`
    INSERT INTO categories (name, icon, color, wallet_id, parent_id, created_by_user_id)
    VALUES (${name}, ${icon || null}, ${color || null}, ${walletId || null}, ${parentId || null}, ${authUserId})
    RETURNING id, name, icon, color
  `;

  return {
    body: {
      success: true,
      category: {
        id: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
      },
    },
  };
}

/**
 * Edit a custom category
 */
export async function handleEditCategory(sql, categoryId, body, authUserId) {
  const [existing] = await sql`
    SELECT id, wallet_id, created_by_user_id FROM categories WHERE id = ${categoryId}
  `;

  if (!existing) {
    return { status: 404, body: { success: false, message: 'Category not found' } };
  }

  // Can't edit global/seeded categories
  if (!existing.wallet_id) {
    return { status: 403, body: { success: false, message: 'Cannot edit default categories' } };
  }

  // Verify user has access to the wallet
  const access = await checkWalletAccess(sql, existing.wallet_id, authUserId);
  if (!access.role || access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Insufficient permissions' } };
  }

  const { name, icon, color } = body;
  const hasName = 'name' in body;
  const hasIcon = 'icon' in body;
  const hasColor = 'color' in body;

  const [updated] = await sql`
    UPDATE categories SET
      name = CASE WHEN ${hasName} THEN ${name} ELSE name END,
      icon = CASE WHEN ${hasIcon} THEN ${icon} ELSE icon END,
      color = CASE WHEN ${hasColor} THEN ${color} ELSE color END
    WHERE id = ${categoryId}
    RETURNING id, name, icon, color
  `;

  return {
    body: {
      success: true,
      category: { id: updated.id, name: updated.name, icon: updated.icon, color: updated.color },
    },
  };
}

/**
 * Delete a custom category
 */
export async function handleDeleteCategory(sql, categoryId, authUserId) {
  const [existing] = await sql`
    SELECT id, wallet_id FROM categories WHERE id = ${categoryId}
  `;

  if (!existing) {
    return { status: 404, body: { success: false, message: 'Category not found' } };
  }

  if (!existing.wallet_id) {
    return { status: 403, body: { success: false, message: 'Cannot delete default categories' } };
  }

  const access = await checkWalletAccess(sql, existing.wallet_id, authUserId);
  if (!access.role || access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Insufficient permissions' } };
  }

  await sql`DELETE FROM categories WHERE id = ${categoryId}`;

  return {
    body: { success: true, message: 'Category deleted' },
  };
}
