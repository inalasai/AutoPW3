# Admin Bootstrap (TASK-04)

Status: **implemented and tested on PostgreSQL 17.10 with a test shim; NOT yet run on a real Supabase project** (L-033). Decisions D-005 and D-033.

The first household and its first ADMIN are created by exactly one function call, made once by the platform owner. After that, everyone else joins by invitation. There is no sign-up path that grants a role, no default role, and no way to run the bootstrap again.

## What it is

`private.bootstrap_first_admin(email text, household_name text, timezone text) returns uuid`

- `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` revoked from `PUBLIC`, `anon` and `authenticated`; granted to `service_role`. The `private` schema is not exposed through the API, so it cannot be called from a browser or through PostgREST at all.
- It does not create users and handles no password or token. The owner signs up and **confirms the email** first; the function looks the user up by confirmed email.
- It refuses when `system_bootstrap` already has its row, or when any ADMIN exists. A concurrent second call waits on an advisory lock and then sees the first one's committed result.
- In one transaction it creates the household (timezone validated against `pg_timezone_names`), its `household_settings` row, the ADMIN membership, the permanent `system_bootstrap` marker (it stores only a SHA-256 of the email) and an audit row `bootstrap.completed` (actor `SYSTEM`, metadata only the household id).
- The marker is permanent: it survives deletion of the household, so the function stays impossible to run again.

| Error | SQLSTATE | Meaning |
|---|---|---|
| `bootstrap_already_completed` | `P0001` | It has already run |
| `bootstrap_not_allowed` | `P0001` | An ADMIN exists (for example created by hand) |
| `invalid_argument` | `P0001` | Empty email or household name (1 to 100 characters) |
| `bootstrap_user_not_found` | `P0002` | No user with that email, or the email is not confirmed |
| `invalid IANA timezone` | `22023` | Not a name in `pg_timezone_names` |

## How to run it (owner, once)

1. Create the Supabase project and apply the migrations (`supabase db push`, or `npm run db:reset` locally).
2. Sign up in the app (or in Supabase Auth) with the owner's email and confirm it. The sign-up creates a profile and **no** role.
3. Open the Supabase SQL editor (it runs as the `postgres` owner role) and run, with your own values:

```sql
select private.bootstrap_first_admin('owner@example.com', 'My home', 'Europe/Dublin');
```

   Use your real email and IANA timezone. The example values here are placeholders, not credentials.

4. Verify:

```sql
select household_id, completed_at from public.system_bootstrap;                 -- one row
select household_id, user_id, role from public.household_members;               -- your user, ADMIN
select action, actor_type, created_at from public.audit_log order by id;        -- member.added, bootstrap.completed
```

5. Try a second call: it must fail with `bootstrap_already_completed`.

The Worker does not call this function (S6 in `SECURITY_MODEL.md` is the operator running it). If an automation ever needs to, it must use a direct database connection as `service_role` or `postgres`; PostgREST cannot reach schema `private`.

### Local development

`supabase db reset` loads `supabase/seed.sql`, which creates one labelled household with no members. Sign up a local user (Studio at the local URL; confirm through the local mail catcher), then run the bootstrap as above: it creates a second household for that user. The seed household stays unused. The seed refuses to run on a bootstrapped database.

## Later admin changes

- More ADMINs: an ADMIN calls `public.change_member_role(household, user, 'ADMIN')`, or invites with role `ADMIN` (`create_invitation`). Both are audited.
- Nobody can change their own role or remove themselves (`remove_member`); `leave_household` is the one allowed exit and is refused for the last ADMIN.
- The last ADMIN cannot be demoted, removed, or have their auth account deleted: the database raises `last_admin_protected` for every writer, including the Worker's secret key. To delete the owner's account, first promote another ADMIN or delete the household (a future audited function, L-032; the platform operator can do it by hand).

## Break-glass: no ADMIN left or locked out

This is a platform-operator action in the Supabase dashboard and is **not** a function in the database (a callable recovery path would be an attack surface). Run as `postgres` in the SQL editor:

```sql
-- 1. Find the household and the user to promote
select id, name from public.households;
select id, email from auth.users where email = 'owner@example.com';

-- 2. Add or promote an ADMIN (the membership trigger audits this as a SYSTEM member.added / member.role_changed)
insert into public.household_members (household_id, user_id, role)
values ('<household id>', '<user id>', 'ADMIN')
on conflict (household_id, user_id) do update set role = 'ADMIN';
```

If the household itself is gone, create a `households` row, a `household_settings` row and the membership by hand; the `system_bootstrap` marker stays, which is correct. Record why you did it in `docs/DECISIONS.md` (append-only). Anyone with SQL editor access can do this by design (see "Residual risks" in `SECURITY_MODEL.md`).

## Tests

`supabase/tests/database/060_admin_bootstrap.test.sql` covers: not executable by `anon` or `authenticated`; refused when an ADMIN exists; argument, unknown user, unconfirmed user and invalid timezone failures leave no marker and no membership; success creates the ADMIN, the household, the settings, the hashed marker and the audit row; the second call fails; the call stays impossible after the household is deleted; the marker table is unreadable by API roles. Run with `npm run db:test`.
