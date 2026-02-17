-- ── VCReach Database Backup Strategy ─────────────────────────────────
-- This file documents the backup approach for the PostgreSQL database.

-- ═══════════════════════════════════════════════════════════════════
-- 1. AUTOMATED DAILY BACKUPS (via pg_dump cron)
-- ═══════════════════════════════════════════════════════════════════
-- Schedule: Daily at 02:00 UTC
-- Retention: 7 daily, 4 weekly, 3 monthly
--
-- Example cron entry (on a backup host or CI runner):
--   0 2 * * * pg_dump "$DATABASE_URL" --format=custom --compress=9 \
--     -f /backups/vcreach-$(date +\%Y\%m\%d).dump
--
-- For Fly.io Postgres (managed):
--   Fly.io automatically takes daily snapshots with 7-day retention.
--   Use `fly postgres backup list` to verify.
--   Restore: `fly postgres backup restore <backup-id>`

-- ═══════════════════════════════════════════════════════════════════
-- 2. POINT-IN-TIME RECOVERY (WAL archiving)
-- ═══════════════════════════════════════════════════════════════════
-- If self-hosting PostgreSQL, enable WAL archiving:
--   archive_mode = on
--   archive_command = 'cp %p /archive/%f'
--   wal_level = replica
--
-- This enables recovery to any point in time within the retention window.

-- ═══════════════════════════════════════════════════════════════════
-- 3. PRE-MIGRATION BACKUP
-- ═══════════════════════════════════════════════════════════════════
-- Always run a backup before schema migrations:
--   pg_dump "$DATABASE_URL" --format=custom -f pre-migration-$(date +%s).dump

-- ═══════════════════════════════════════════════════════════════════
-- 4. APP-STATE TABLE SNAPSHOT
-- ═══════════════════════════════════════════════════════════════════
-- The app_state table stores the full app state as JSONB.
-- Quick export for disaster recovery:

-- Export current state as JSON:
-- \copy (SELECT payload FROM app_state WHERE id = 1) TO '/tmp/vcreach-state.json'

-- Restore from JSON backup:
-- UPDATE app_state SET payload = (SELECT pg_read_file('/tmp/vcreach-state.json')::jsonb), updated_at = NOW() WHERE id = 1;

-- ═══════════════════════════════════════════════════════════════════
-- 5. VERIFICATION
-- ═══════════════════════════════════════════════════════════════════
-- Weekly: Restore latest backup to a test database and verify data integrity
-- Monthly: Full disaster recovery drill
--
-- Verification query after restore:
SELECT
  (SELECT count(*) FROM app_state) AS state_rows,
  (SELECT count(*) FROM users) AS user_count,
  (SELECT count(*) FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > NOW()) AS active_sessions,
  (SELECT count(*) FROM workspace_memberships) AS memberships;
