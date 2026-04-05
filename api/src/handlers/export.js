import { checkWalletAccess } from './wallets.js';

/**
 * Export wallet transactions as CSV.
 * Returns a special { csv, filename } result that index.js handles differently.
 */
export async function handleExportCsv(sql, walletId, searchParams, authUserId) {
  const access = await checkWalletAccess(sql, walletId, authUserId);
  if (!access.exists) {
    return { status: 404, body: { success: false, message: 'Wallet not found' } };
  }
  if (!access.role) {
    return { status: 403, body: { success: false, message: 'You are not a member of this wallet' } };
  }

  const fromDate = searchParams.get('from');
  const toDate = searchParams.get('to');

  const [wallet] = await sql`SELECT name FROM wallets WHERE id = ${walletId}`;

  const transactions = await sql`
    SELECT
      t.date,
      t.type,
      t.description,
      t.amount,
      c.code AS currency,
      cat.name AS category,
      t.payment_method,
      t.notes,
      u.name AS created_by
    FROM transactions t
    JOIN currencies c ON t.currency_id = c.id
    LEFT JOIN categories cat ON t.category_id = cat.id
    JOIN users u ON t.created_by_user_id = u.id
    WHERE t.wallet_id = ${walletId}
      AND t.deleted_at IS NULL
      AND (${fromDate}::date IS NULL OR t.date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR t.date <= ${toDate}::date)
    ORDER BY t.date DESC, t.created_at DESC
    LIMIT 10000
  `;

  // Build CSV
  const headers = ['Date', 'Type', 'Description', 'Amount', 'Currency', 'Category', 'Payment Method', 'Notes', 'Created By'];
  const rows = transactions.map((t) => [
    t.date,
    t.type,
    escapeCsv(t.description || ''),
    t.amount,
    t.currency,
    t.category || '',
    t.payment_method || '',
    escapeCsv(t.notes || ''),
    t.created_by,
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const safeName = wallet.name.replace(/[^a-zA-Z0-9]/g, '_');

  return {
    csv,
    filename: `${safeName}_transactions.csv`,
  };
}

export function escapeCsv(str) {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
