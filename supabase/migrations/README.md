# Database migrations

Forward-only PostgreSQL migrations are applied in timestamp order. Never edit an applied historical
migration; create a new migration and verify it against throwaway PostgreSQL with `npm run db:verify` and
`npm run db:test`. Local verification does not apply migrations to hosted Supabase.

**Status:** Phase 2 adds `20261031160000_authorize_tesla_oauth_persistence.sql`: service-only current-ADMIN validation and an atomic, role-locked credential save with actor audit. No tables or RLS policies change. Hosted application remains NOT_EXECUTED.
