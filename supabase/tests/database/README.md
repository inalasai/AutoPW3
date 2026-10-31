# Database security tests

Ordered `*.test.sql` files run against throwaway PostgreSQL 17 through `npm run db:test`. Keep each TAP
plan exact and roll back fixtures. These tests validate local PostgreSQL behavior, not hosted Supabase
configuration or Cloudflare runtime bindings.

**Status:** `141_staging_identity_read.test.sql` exercises the profile and household join used by the
staging `/me` slice under authenticated roles, including unrelated households and users without memberships.
