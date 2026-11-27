create table if not exists public.calorie_trial_steps (
  day date not null,
  browser_id uuid not null,
  event_name text not null check (event_name in ('trial_click', 'code_request', 'code_sent')),
  primary key (day, browser_id, event_name)
);

create table if not exists public.calorie_trial_activations (
  account_id uuid primary key,
  started_at timestamptz not null
);

create table if not exists public.calorie_trial_usage_config (
  singleton boolean primary key default true check (singleton),
  measurement_started_at timestamptz not null default now()
);
insert into public.calorie_trial_usage_config default values on conflict do nothing;

alter table public.calorie_trial_usage_config enable row level security;
alter table public.calorie_trial_steps enable row level security;
alter table public.calorie_trial_activations enable row level security;
revoke all on public.calorie_trial_steps, public.calorie_trial_activations,
  public.calorie_trial_usage_config from anon, authenticated;

create or replace function public.record_calorie_trial_step(event_name text, browser_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.calorie_trial_steps (day, browser_id, event_name)
  values ((now() at time zone 'Asia/Jerusalem')::date, $2, $1)
  on conflict do nothing;
$$;

-- Keep the app's existing access check as the source of truth about trial access.
create or replace function public.calorie_customer_access_with_trial_usage()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  access_data jsonb;
  trial_start timestamptz;
begin
  if account is null then
    raise insufficient_privilege;
  end if;

  select to_jsonb(reply.access) into access_data
  from (select public.calorie_access_status() as access) as reply;

  if (access_data->>'active')::boolean
    and access_data->>'state' not in ('manager', 'paid', 'expired') then
    trial_start := (access_data->>'access_until')::timestamptz - interval '168 hours';
    -- Record newly opened trials and give a recently started trial time to retry.
    if trial_start between now() - interval '1 hour' and now()
      and trial_start >= (select measurement_started_at from public.calorie_trial_usage_config) then
      insert into public.calorie_trial_activations (account_id, started_at)
      values (account, trial_start)
      on conflict (account_id) do nothing;
    end if;
  end if;
  return access_data;
end;
$$;

create or replace function public.calorie_trial_usage_summary(days integer)
returns table (
  day date,
  trial_clicks bigint,
  code_requests bigint,
  codes_sent bigint,
  trials_started bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  access_data jsonb;
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  first_day date := today - greatest(1, least(coalesce(days, 7), 30)) + 1;
  measurement_day date;
begin
  if auth.uid() is null then
    raise insufficient_privilege;
  end if;
  select to_jsonb(reply.access) into access_data
  from (select public.calorie_access_status() as access) as reply;
  if access_data->>'state' is distinct from 'manager' then
    raise insufficient_privilege;
  end if;

  select (measurement_started_at at time zone 'Asia/Jerusalem')::date into measurement_day
  from public.calorie_trial_usage_config;

  return query
  with steps_by_day as (
    select step.day,
      count(*) filter (where event_name = 'trial_click') as clicks,
      count(*) filter (where event_name = 'code_request') as requests,
      count(*) filter (where event_name = 'code_sent') as sent
    from public.calorie_trial_steps as step
    where step.day between first_day and today
    group by step.day
  ), activations_by_day as (
    select (started_at at time zone 'Asia/Jerusalem')::date as activation_day, count(*) as total
    from public.calorie_trial_activations
    where started_at >= (first_day::timestamp at time zone 'Asia/Jerusalem')
    group by 1
  )
  select first_day + offset_days.n, coalesce(steps.clicks, 0), coalesce(steps.requests, 0),
    coalesce(steps.sent, 0), coalesce(activations.total, 0)
  from generate_series(0, today - first_day) as offset_days(n)
  left join steps_by_day as steps on steps.day = first_day + offset_days.n
  left join activations_by_day as activations on activations.activation_day = first_day + offset_days.n
  where first_day + offset_days.n >= measurement_day
  order by offset_days.n desc;
end;
$$;

revoke all on function public.record_calorie_trial_step(text, uuid) from public, anon, authenticated;
revoke all on function public.calorie_customer_access_with_trial_usage() from public, anon, authenticated;
revoke all on function public.calorie_trial_usage_summary(integer) from public, anon, authenticated;
grant execute on function public.record_calorie_trial_step(text, uuid) to anon, authenticated;
grant execute on function public.calorie_customer_access_with_trial_usage() to authenticated;
grant execute on function public.calorie_trial_usage_summary(integer) to authenticated;
