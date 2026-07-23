-- ============================================
-- Follow-up fix for projects set up before this file existed.
-- Run this once in the SQL Editor against your live demo project.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default.
-- reset_demo_data() was never explicitly locked down, so the public
-- anon key (embedded in the demo's client-side JS by design) could
-- call it directly via /rest/v1/rpc/reset_demo_data instead of
-- waiting for the scheduled pg_cron job. Only pg_cron should ever
-- run this function.
--
-- This is already folded into sql/setup.sql for anyone deploying
-- fresh from now on.
-- ============================================

revoke execute on function reset_demo_data() from public, anon, authenticated;
