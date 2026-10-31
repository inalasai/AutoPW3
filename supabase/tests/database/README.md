# Database security tests

Ordered `*.test.sql` files run against throwaway PostgreSQL 17 through `npm run db:test`. Keep each TAP
plan exact and roll back fixtures. These tests validate local PostgreSQL behavior, not hosted Supabase
configuration or Cloudflare runtime bindings.

**Status:** `141_staging_identity_read.test.sql` exercises the profile and household join used by the
staging `/me` slice under authenticated roles, including unrelated households and users without memberships.

`142_authenticated_site_reads.test.sql` adds 24 local authenticated RLS assertions for site metadata,
household membership, cross-household denial, UUID cursor pagination, empty households and revocation.
The tests reuse existing tables and policies; no migration or permission change is required.
