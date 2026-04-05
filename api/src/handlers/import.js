import { checkWalletAccess } from './wallets.js';

const MAX_IMPORT_BATCH = 1000;

// Map Spendee category names to existing mine26 category names
const CATEGORY_ALIASES = {
  'food & drink': 'Food & Dining',
  'utilities': 'Bills & Utilities',
};

/**
 * Bulk import transactions into a wallet.
 * Designed for migrating from Spendee or similar apps.
 *
 * Body: { transactions: [{ date, type, categoryName, amount, currencyCode, description, paymentMethod, notes }, ...] }
 *
 * - amount: absolute value used (negative signs stripped)
 * - date: ISO timestamp or date string (time portion stripped)
 * - type: "income" or "expense" (case-insensitive, defaults to "expense")
 * - categoryName: matched case-insensitively against existing categories, with alias support
 */
export async function handleImport(sql, walletId, body, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role || access.role === 'viewer') {
    return { status: 403, body: { success: false, message: 'Viewers cannot import transactions' } };
  }

  const { transactions } = body;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return { status: 400, body: { success: false, message: 'transactions array is required' } };
  }

  if (transactions.length > MAX_IMPORT_BATCH) {
    return {
      status: 400,
      body: { success: false, message: `Maximum ${MAX_IMPORT_BATCH} transactions per import` },
    };
  }

  // Pre-resolve all currency codes
  const allCurrencyCodes = [...new Set(
    transactions.map(t => t.currencyCode).filter(Boolean)
  )];

  const currencyRows = allCurrencyCodes.length > 0
    ? await sql`SELECT id, code FROM currencies WHERE code = ANY(${allCurrencyCodes})`
    : [];
  const currencyMap = {};
  for (const c of currencyRows) currencyMap[c.code] = c.id;

  // Pre-resolve all category names (global + wallet-scoped)
  const categories = await sql`
    SELECT id, name FROM categories
    WHERE wallet_id IS NULL OR wallet_id = ${walletId}
  `;
  // Build case-insensitive lookup
  const categoryMap = {};
  for (const c of categories) {
    categoryMap[c.name.toLowerCase()] = c.id;
  }

  const errors = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    const row = i + 1;

    if (!t.date || t.amount == null || !t.currencyCode) {
      errors.push({ row, error: 'date, amount, and currencyCode are required' });
      skipped++;
      continue;
    }

    const currencyId = currencyMap[t.currencyCode];
    if (!currencyId) {
      errors.push({ row, error: `Invalid currency code: ${t.currencyCode}` });
      skipped++;
      continue;
    }

    // Parse date — strip time portion
    const date = String(t.date).substring(0, 10);

    // Amount — use absolute value
    const amount = Math.abs(parseFloat(t.amount));
    if (isNaN(amount) || amount === 0) {
      errors.push({ row, error: 'amount must be a non-zero number' });
      skipped++;
      continue;
    }

    // Type
    const rawType = String(t.type || '').toLowerCase();
    const txType = rawType === 'income' ? 'income' : 'expense';

    // Category — resolve by name with alias support
    let categoryId = null;
    if (t.categoryName) {
      const lowerName = t.categoryName.toLowerCase();
      const aliased = CATEGORY_ALIASES[lowerName];
      categoryId = aliased
        ? categoryMap[aliased.toLowerCase()] || null
        : categoryMap[lowerName] || null;
    }

    try {
      await sql`
        INSERT INTO transactions
        (wallet_id, date, description, amount, type, currency_id, category_id,
         payment_method, notes, created_by_user_id)
        VALUES (
          ${walletId}, ${date}, ${t.description || null}, ${amount}, ${txType},
          ${currencyId}, ${categoryId}, ${t.paymentMethod || null},
          ${t.notes || null}, ${authUserId}
        )
      `;
      imported++;
    } catch (err) {
      errors.push({ row, error: err.message });
      skipped++;
    }
  }

  return {
    body: {
      success: true,
      imported,
      skipped,
      total: transactions.length,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
}
