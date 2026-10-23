-- TASK-03 migration 3/7: energy sites, Tesla credentials, OAuth state.
-- Design: docs/DATABASE_DESIGN.md section 2.2. Safe to re-run (idempotent).
-- tesla_credentials and oauth_states must never be readable by anon or authenticated (docs/SECURITY_MODEL.md S1, S8).
--
-- Rollback notes (development only):
--   drop table if exists public.oauth_states, public.tesla_credentials, public.energy_sites cascade;

set search_path = public, extensions;

create table if not exists public.energy_sites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Only real provider data is stored. There is no DEMO provider in the database (D-017).
  provider text not null check (provider = 'TESLA'),
  provider_site_id text not null check (char_length(provider_site_id) between 1 and 100),
  name text check (name is null or char_length(name) between 1 and 100),
  timezone text not null,
  connection_state text not null default 'CONNECTING'
    check (connection_state in ('CONNECTING', 'LIVE', 'STALE', 'ERROR', 'DISCONNECTED')),
  capabilities_snapshot jsonb check (capabilities_snapshot is null or jsonb_typeof(capabilities_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (provider, provider_site_id),
  -- Lets child tables prove (site_id, household_id) belong together with a composite foreign key.
  unique (id, household_id)
);
comment on column public.energy_sites.timezone is 'IANA timezone of the site. Defines the local calendar day for rollups and tariffs.';
comment on column public.energy_sites.provider is 'Always TESLA. The Tesla mock adapter shares this value in local/test; it can never write DEMO data here (D-017).';
create index if not exists energy_sites_household_id_idx on public.energy_sites (household_id);

drop trigger if exists energy_sites_validate_timezone on public.energy_sites;
create trigger energy_sites_validate_timezone
  before insert or update of timezone on public.energy_sites
  for each row execute function private.validate_timezone();

-- Encrypted Tesla tokens (docs/SYSTEM_ARCHITECTURE.md section 8). Ciphertext only: AES-256-GCM with a
-- 96-bit nonce; the key lives in Cloudflare secrets, never here. AAD = household_id | provider | id | key_id.
create table if not exists public.tesla_credentials (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households (id) on delete cascade,
  key_id text not null check (char_length(key_id) between 1 and 64),
  nonce bytea not null check (octet_length(nonce) = 12),
  ciphertext bytea not null check (octet_length(ciphertext) > 16),
  version integer not null default 1 check (version >= 1),
  scopes text[],
  fleet_api_base_url text not null check (fleet_api_base_url ~ '^https://'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'NEEDS_REAUTH', 'REVOKED')),
  access_expires_at timestamptz,
  refresh_issued_at timestamptz,
  last_refresh_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.tesla_credentials is
  'Encrypted Tesla OAuth tokens. No access for anon or authenticated; only the Worker secret key reads it (docs/SECURITY_MODEL.md S1).';
comment on column public.tesla_credentials.ciphertext is 'AES-256-GCM ciphertext of {access_token, refresh_token}. Plaintext tokens are never stored.';
comment on column public.tesla_credentials.fleet_api_base_url is 'Regional Fleet API base URL discovered per user. The EU value is UNVERIFIED (Q-02).';

drop trigger if exists tesla_credentials_touch_updated_at on public.tesla_credentials;
create trigger tesla_credentials_touch_updated_at
  before update on public.tesla_credentials
  for each row execute function private.touch_updated_at();

-- Pending Tesla OAuth authorisations. Single use; the state value is stored only as a hash.
create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash bytea not null unique check (octet_length(state_hash) = 32),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  pkce_verifier_ciphertext bytea not null,
  pkce_nonce bytea not null check (octet_length(pkce_nonce) = 12),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists oauth_states_expires_at_idx on public.oauth_states (expires_at);
create index if not exists oauth_states_household_id_idx on public.oauth_states (household_id);

select private.lock_down_public_tables();
