# Database security tests

Ordered `*.test.sql` files run against throwaway PostgreSQL 17 through `npm run db:test`. Keep each TAP
plan exact and roll back fixtures. These tests validate local PostgreSQL behavior, not hosted Supabase
configuration or Cloudflare runtime bindings.
