-- Endurecimiento de RPC financiera (UTC consistente + search_path seguro).

begin;

create or replace function public.get_today_extra_income()
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from public.extra_charges
  where charge_type = 'half_day'
    and (created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date;
$$;

revoke all on function public.get_today_extra_income() from public;
grant execute on function public.get_today_extra_income() to authenticated;

commit;
