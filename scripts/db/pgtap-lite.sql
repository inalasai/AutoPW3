-- TEST-ONLY. A tiny stand-in for pgTAP, used by scripts/db-test.mjs when the pgTAP extension is not available
-- (embedded PostgreSQL has no pgTAP). It is NOT pgTAP: it implements only the functions the files in
-- supabase/tests/database use, with the same names, argument order and TAP output:
--   plan(n), ok(bool, desc), is(a, b, desc), isnt(a, b, desc), throws_ok(sql, sqlstate, message, desc),
--   lives_ok(sql, desc), finish().
-- The test files are written so they also run unchanged under real pgTAP (`supabase test db`), where this
-- file is not used. throws_ok here compares the message by exact equality (or skips it when NULL), as pgTAP does.
-- Never applied by migrations or by `supabase db reset`.

create schema if not exists extensions;

create or replace function extensions.plan(n integer)
returns text
language plpgsql
as $$
begin
  perform set_config('pgtap.planned', n::text, false);
  perform set_config('pgtap.run', '0', false);
  perform set_config('pgtap.failed', '0', false);
  return '1..' || n;
end
$$;

create or replace function extensions.ok(passed boolean, descr text default '')
returns text
language plpgsql
as $$
declare
  n integer := coalesce(nullif(current_setting('pgtap.run', true), ''), '0')::integer + 1;
begin
  perform set_config('pgtap.run', n::text, false);
  if passed is not true then
    perform set_config('pgtap.failed',
      (coalesce(nullif(current_setting('pgtap.failed', true), ''), '0')::integer + 1)::text, false);
    return 'not ok ' || n || ' - ' || coalesce(descr, '');
  end if;
  return 'ok ' || n || ' - ' || coalesce(descr, '');
end
$$;

create or replace function extensions.is(have anyelement, want anyelement, descr text default '')
returns text
language plpgsql
as $$
declare
  r text;
begin
  r := extensions.ok(have is not distinct from want, descr);
  if r like 'not ok%' then
    r := r || E'\n# have: ' || coalesce(have::text, 'NULL') || E'\n# want: ' || coalesce(want::text, 'NULL');
  end if;
  return r;
end
$$;

create or replace function extensions.isnt(have anyelement, want anyelement, descr text default '')
returns text
language plpgsql
as $$
begin
  return extensions.ok(have is distinct from want, descr);
end
$$;

-- Runs sql as the CURRENT role (so role switches in the test are honoured) and passes only when it raises the
-- expected SQLSTATE (and, when given, exactly the expected message).
create or replace function extensions.throws_ok(sql text, errcode text, errmsg text, descr text default '')
returns text
language plpgsql
as $$
declare
  got_state text;
  got_msg text;
begin
  begin
    execute sql;
  exception when others then
    get stacked diagnostics got_state = returned_sqlstate, got_msg = message_text;
    if got_state = errcode and (errmsg is null or got_msg = errmsg) then
      return extensions.ok(true, descr);
    end if;
    return extensions.ok(false, descr)
      || E'\n# caught: ' || got_state || ': ' || got_msg
      || E'\n# wanted: ' || errcode || ': ' || coalesce(errmsg, 'anything');
  end;
  return extensions.ok(false, descr) || E'\n# no exception thrown; wanted ' || errcode;
end
$$;

create or replace function extensions.lives_ok(sql text, descr text default '')
returns text
language plpgsql
as $$
declare
  got_state text;
  got_msg text;
begin
  begin
    execute sql;
  exception when others then
    get stacked diagnostics got_state = returned_sqlstate, got_msg = message_text;
    return extensions.ok(false, descr) || E'\n# threw ' || got_state || ': ' || got_msg;
  end;
  return extensions.ok(true, descr);
end
$$;

create or replace function extensions.finish()
returns setof text
language plpgsql
as $$
declare
  planned integer := coalesce(nullif(current_setting('pgtap.planned', true), ''), '0')::integer;
  run integer := coalesce(nullif(current_setting('pgtap.run', true), ''), '0')::integer;
  failed integer := coalesce(nullif(current_setting('pgtap.failed', true), ''), '0')::integer;
begin
  if run <> planned then
    return next 'not ok - planned ' || planned || ' tests but ran ' || run;
  end if;
  if failed > 0 then
    return next '# Looks like you failed ' || failed || ' test(s) of ' || run;
  end if;
end
$$;

grant execute on all functions in schema extensions to public;
