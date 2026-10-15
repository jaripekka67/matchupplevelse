-- Migration 4: fogis_check – behörighetskontroll som Edge Function fogis-api anropar innan
-- den hämtar matcher från FOGIS. Kräver inloggad och med i laget (in_team). Appen har inget
-- modulsystem, så ingen modulkontroll (till skillnad från ledarportalens svff_check).

create or replace function public.fogis_check(p_team uuid)
returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Inte inloggad' using errcode = '42501';
  end if;
  if not public.in_team(p_team) then
    raise exception 'Ingen behörighet för laget' using errcode = '42501';
  end if;
end $$;

revoke execute on function public.fogis_check(uuid) from public, anon;
grant  execute on function public.fogis_check(uuid) to authenticated;
