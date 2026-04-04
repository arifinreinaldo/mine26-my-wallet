/**
 * Create a mock SQL tagged template function for testing handlers.
 *
 * Usage:
 *   const sql = createMockSql([
 *     { match: 'SELECT id FROM currencies', result: [{ id: 1 }] },
 *     { match: 'INSERT INTO transactions', result: [{ id: 42 }] },
 *     { match: 'FAIL HERE', throws: new Error('DB error') },
 *   ]);
 *
 * The mock matches query patterns in order — first match wins.
 * If no pattern matches, returns empty array.
 * Use `result` as a function for dynamic responses: (values) => [...]
 * Use `throws` to simulate a database error.
 */
export function createMockSql(handlers = []) {
  const calls = [];

  const sql = async (strings, ...values) => {
    const query = strings.join('$');
    calls.push({ query, values });

    for (const h of handlers) {
      if (query.includes(h.match)) {
        if (h.throws) throw h.throws;
        return typeof h.result === 'function' ? h.result(values) : h.result;
      }
    }
    return [];
  };

  sql.calls = calls;

  /** Return all calls whose query contains the given pattern. */
  sql.callsTo = (pattern) => calls.filter(c => c.query.includes(pattern));

  return sql;
}
