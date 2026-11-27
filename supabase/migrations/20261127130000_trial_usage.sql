create table if not exists usage_metrics.trial_steps (
  day date not null,
  browser_id uuid not null,
  event_name text not null check (event_name in ('trial_click', 'code_request', 'code_sent')),
  primary key (day, browser_id, event_name)
);

create table if not exists usage_metrics.trial_measurement (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default now()
);
insert into usage_metrics.trial_measurement default values on conflict do nothing;

alter table usage_metrics.trial_steps enable row level security;
alter table usage_metrics.trial_measurement enable row level security;
revoke all on usage_metrics.trial_steps, usage_metrics.trial_measurement from public, anon, authenticated;

create or replace function public.record_calorie_trial_step(event_name text, browser_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into usage_metrics.trial_steps (day, browser_id, event_name)
  values ((now() at time zone 'Asia/Jerusalem')::date, $2, $1)
  on conflict do nothing;
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
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  first_day date;
  measurement_day date;
begin
  if not coalesce(usage_metrics.is_current_manager(), false) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  if days is null or days not in (1, 7, 30) then
    raise exception 'Invalid period' using errcode = '22023';
  end if;
  first_day := today - (days - 1);

  select (started_at at time zone 'Asia/Jerusalem')::date into measurement_day
  from usage_metrics.trial_measurement;

  return query
  with steps_by_day as (
    select step.day,
      count(*) filter (where event_name = 'trial_click') as clicks,
      count(*) filter (where event_name = 'code_request') as requests,
      count(*) filter (where event_name = 'code_sent') as sent
    from usage_metrics.trial_steps as step
    where step.day between first_day and today
    group by step.day
  ), activations_by_day as (
    -- Each customer row is created on the first verified access. Its original
    -- trial_end is set seven days ahead, including for customers who later paid.
    select ((trial_end - interval '168 hours') at time zone 'Asia/Jerusalem')::date as activation_day,
      count(*) as total
    from calorie_access.customers
    where trial_end >= (first_day::timestamp at time zone 'Asia/Jerusalem') + interval '168 hours'
    group by 1
  )
  select report.day,
    case when report.day >= measurement_day then coalesce(steps.clicks, 0) end,
    case when report.day >= measurement_day then coalesce(steps.requests, 0) end,
    case when report.day >= measurement_day then coalesce(steps.sent, 0) end,
    coalesce(activations.total, 0)
  from (select first_day + n as day from generate_series(0, days - 1) as offsets(n)) as report
  left join steps_by_day as steps on steps.day = report.day
  left join activations_by_day as activations on activations.activation_day = report.day
  order by report.day desc;
end;
$$;

revoke all on function public.record_calorie_trial_step(text, uuid) from public, anon, authenticated;
revoke all on function public.calorie_trial_usage_summary(integer) from public, anon, authenticated;
grant execute on function public.record_calorie_trial_step(text, uuid) to anon, authenticated;
grant execute on function public.calorie_trial_usage_summary(integer) to authenticated;
