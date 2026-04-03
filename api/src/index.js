import { neon } from '@neondatabase/serverless';
import { handleRoute } from './router.js';
import { handleFetchRates } from './handlers/rates.js';
import { processRecurringTransactions } from './handlers/recurring.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const sql = neon(env.DATABASE_URL);
      const url = new URL(request.url);

      const result = await handleRoute(sql, request.method, url, request, env);

      if (result) {
        // CSV export returns { csv, filename } instead of { status, body }
        if (result.csv) {
          return new Response(result.csv, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/csv',
              'Content-Disposition': `attachment; filename="${result.filename}"`,
            },
          });
        }
        return jsonResponse(result.body, result.status || 200);
      }

      return jsonResponse({ error: 'Not Found' }, 404);
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  },

  async scheduled(event, env) {
    const sql = neon(env.DATABASE_URL);
    try {
      await handleFetchRates(sql);
      console.log('Scheduled rate fetch completed');
    } catch (error) {
      console.error('Scheduled rate fetch failed:', error);
    }
    try {
      const count = await processRecurringTransactions(sql);
      console.log(`Processed ${count} recurring transactions`);
    } catch (error) {
      console.error('Recurring transactions processing failed:', error);
    }
    try {
      await sql`DELETE FROM transactions WHERE deleted_at < NOW() - INTERVAL '90 days'`;
      console.log('Soft delete cleanup completed');
    } catch (error) {
      console.error('Soft delete cleanup failed:', error);
    }
  },
};
