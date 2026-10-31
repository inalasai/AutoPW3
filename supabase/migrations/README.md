# Database migrations

Forward-only PostgreSQL migrations are applied in timestamp order. Never edit an applied historical
migration; create a new migration and verify it against throwaway PostgreSQL with `npm run db:verify` and
`npm run db:test`. Local verification does not apply migrations to hosted Supabase.
