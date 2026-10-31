-- Restrict profile directory reads to administrators of a household shared with the profile owner.
-- Keep this as a forward migration so an already migrated database receives the fix as well.
drop policy if exists user_profiles_select_self_or_household_admin on public.user_profiles;
create policy user_profiles_select_self_or_household_admin on public.user_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.household_members target_membership
      where target_membership.user_id = user_profiles.user_id
        and private.has_role_at_least(target_membership.household_id, 'ADMIN')
    )
  );
