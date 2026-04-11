# Sync

## Overview
Offline sync protocol allowing clients to work offline and synchronize changes with the server. Uses client-generated UUIDs for idempotency, last-write-wins conflict resolution, and soft deletes.

## Rules

1. **Push sync** (`POST /api/wallets/:id/sync/push`) — Client sends batch of changes (max 500).
2. **Operations**: `create` (upsert), `update` (last-write-wins), `delete` (soft delete).
3. **Idempotency** — `client_id` (UUID) is the unique key. Re-pushing the same `client_id` uses `ON CONFLICT (client_id) DO UPDATE` with timestamp comparison.
4. **Last-write-wins (LWW)** — Update only applies if `clientUpdatedAt > server.updated_at`. If server is newer, returns `conflict` status (not an error).
5. **Clock drift protection** — Rejects changes where `clientUpdatedAt > NOW() + 5 minutes`. Prevents future-dated timestamps from permanently winning conflicts.
6. **Soft delete via sync** — `delete` operation sets `deleted_at = NOW()`. Returns `already_deleted` if already deleted.
7. **Cannot resurrect** — Creating a record with a `client_id` that matches a soft-deleted transaction returns `conflict`. Deleted records cannot be un-deleted via sync.
8. **Pull sync** (`POST /api/wallets/:id/sync/pull`):
   - No `since` parameter → full sync (all transactions for wallet)
   - `since` parameter → incremental sync (changes where `updated_at > since`)
   - Includes soft-deleted records (with `deletedAt` field populated) so clients can remove locally
   - Max 1,000 results per pull
   - `hasMore: true` if more changes exist
   - `syncTimestamp` returned ONLY when `hasMore: false` (client stores this for next pull)
9. **Cleanup cron** — Hard-deletes records where `deleted_at < NOW() - 90 days`. Runs daily at 08:00 UTC.

## Edge Cases

1. Client sends `create` for existing `client_id` that's NOT deleted → upsert applies LWW logic (updates if client timestamp is newer).
2. Client sends `update` for deleted transaction → returns error status in results (not HTTP error), other operations in batch continue.
3. Pull with `since` older than 90 days → may miss hard-deleted records. Client should do full sync if gap is too large.
4. `syncTimestamp` only meaningful when `hasMore: false`. If client stores it when `hasMore: true`, they'll skip unseen changes on next pull.
5. Batch partially fails → each operation returns individual status. HTTP response is still 200. Client must check per-operation results.

## Common Mistakes
- Returning `syncTimestamp` when `hasMore: true` — client will miss data on next incremental pull.
- Forgetting clock drift check — a client with a clock set to 2030 would permanently win all conflicts.
- Hard-deleting instead of soft-deleting — breaks sync protocol for other clients.

## Related Pages
- [Transactions](transactions.md) — sync operates on transactions, uses soft deletes
- [Architecture](architecture.md) — cron handles 90-day cleanup
