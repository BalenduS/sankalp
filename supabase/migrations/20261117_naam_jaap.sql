-- Naam Jaap: mantra repetition tracking, goals, reminders, milestones.
-- Lives beside Sankalp's sk_* tables. Every row belongs to one signed-in user (private, not shared with the family).
--
-- Source of truth: jaap_events — one row per (session, local calendar day) holding an ABSOLUTE count.
-- Phones always upsert the absolute value, so a retried or replayed offline write can never double-count,
-- and a session that runs past midnight simply has two rows.
-- jaap_sessions.count / duration_seconds and jaap_daily_progress are derived from jaap_events by triggers.

create table public.jaap_mantras (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  subtitle text check (subtitle is null or length(subtitle) <= 120),
  preset_key text,
  archived boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jaap_mantras_user on public.jaap_mantras(user_id);

create table public.jaap_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mantra_id uuid not null references public.jaap_mantras(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'finished')),
  tz text not null default 'Asia/Kolkata',
  source text not null default 'counter' check (source in ('counter', 'manual')),
  count int not null default 0,             -- derived from jaap_events
  duration_seconds int not null default 0,  -- derived from jaap_events
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index jaap_sessions_user on public.jaap_sessions(user_id, started_at desc);
create index jaap_sessions_mantra on public.jaap_sessions(mantra_id);

create table public.jaap_events (
  session_id uuid not null references public.jaap_sessions(id) on delete cascade,
  local_date date not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mantra_id uuid not null references public.jaap_mantras(id) on delete cascade,
  count int not null check (count >= 0 and count <= 10000000),
  seconds int not null default 0 check (seconds >= 0 and seconds <= 86400),
  first_at timestamptz,
  last_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (session_id, local_date)
);
create index jaap_events_user_date on public.jaap_events(user_id, local_date);
create index jaap_events_mantra on public.jaap_events(mantra_id);

create table public.jaap_daily_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  mantra_id uuid not null references public.jaap_mantras(id) on delete cascade,
  local_date date not null,
  count int not null default 0,
  seconds int not null default 0,
  sessions int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, mantra_id, local_date)
);
create index jaap_daily_progress_mantra on public.jaap_daily_progress(mantra_id);

-- practice_goals in the spec. A goal is never edited in place: changing it closes the old row
-- (effective_until) and opens a new one, so past days are still judged against the goal that applied then.
create table public.jaap_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mantra_id uuid references public.jaap_mantras(id) on delete cascade,   -- null = all mantras together
  goal_type text not null check (goal_type in ('daily_reps', 'daily_malas', 'weekly_malas', 'monthly_reps')),
  target_count int not null check (target_count > 0 and target_count <= 10000000),
  effective_from date not null,
  effective_until date,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from),
  unique nulls not distinct (user_id, mantra_id, goal_type, effective_from)
);
create index jaap_goals_mantra on public.jaap_goals(mantra_id);

create table public.jaap_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mantra_id uuid references public.jaap_mantras(id) on delete set null,
  reminder_type text not null default 'scheduled'
    check (reminder_type in ('scheduled', 'incomplete_goal', 'resume', 'daily_summary', 'weekly_reflection')),
  name text not null check (length(trim(name)) between 1 and 60),
  scheduled_time time not null,
  timezone text not null default 'Asia/Kolkata',
  days_of_week smallint[] not null default '{0,1,2,3,4,5,6}',   -- 0 = Sunday
  enabled boolean not null default true,
  target_count int check (target_count is null or (target_count > 0 and target_count <= 10000000)),
  sound text not null default 'default' check (sound in ('default', 'silent')),
  snooze_minutes int not null default 10 check (snooze_minutes between 1 and 240),
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jaap_reminders_user on public.jaap_reminders(user_id);
create index jaap_reminders_enabled on public.jaap_reminders(enabled) where enabled;
create index jaap_reminders_mantra on public.jaap_reminders(mantra_id);

-- notification_delivery_logs in the spec. dedupe_key is unique: the scheduler claims a delivery by
-- inserting its key first, so two overlapping runs can never send the same reminder twice.
create table public.jaap_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid references public.jaap_reminders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null unique,
  kind text not null,
  scheduled_for timestamptz not null,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'retrying', 'failed', 'skipped', 'no_subscription')),
  attempt_count int not null default 0,
  delivered_at timestamptz,
  title text,
  body text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jaap_delivery_logs_user on public.jaap_delivery_logs(user_id, scheduled_for desc);
create index jaap_delivery_logs_reminder on public.jaap_delivery_logs(reminder_id);
create index jaap_delivery_logs_retry on public.jaap_delivery_logs(delivery_status) where delivery_status in ('pending', 'retrying');

-- practice_milestones in the spec. achieved_at is null for a custom milestone not yet reached.
create table public.jaap_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mantra_id uuid references public.jaap_mantras(id) on delete cascade,   -- null = lifetime, all mantras
  milestone_count int not null check (milestone_count > 0),
  is_custom boolean not null default false,
  achieved_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct (user_id, mantra_id, milestone_count)
);
create index jaap_milestones_mantra on public.jaap_milestones(mantra_id);

-- ---------------------------------------------------------------- derived totals
create or replace function public.jaap_recompute(p_user uuid, p_mantra uuid, p_date date, p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_count int; v_seconds int; v_sessions int;
begin
  select coalesce(sum(e.count), 0), coalesce(sum(e.seconds), 0), count(*) filter (where e.count > 0)
    into v_count, v_seconds, v_sessions
    from public.jaap_events e
   where e.user_id = p_user and e.mantra_id = p_mantra and e.local_date = p_date;
  if v_count = 0 and v_seconds = 0 then
    delete from public.jaap_daily_progress where user_id = p_user and mantra_id = p_mantra and local_date = p_date;
  elsif exists (select 1 from public.jaap_mantras m where m.id = p_mantra) then
    insert into public.jaap_daily_progress as d (user_id, mantra_id, local_date, count, seconds, sessions, updated_at)
    values (p_user, p_mantra, p_date, v_count, v_seconds, v_sessions, now())
    on conflict (user_id, mantra_id, local_date)
    do update set count = excluded.count, seconds = excluded.seconds, sessions = excluded.sessions, updated_at = now();
  end if;
  update public.jaap_sessions s
     set count = t.c, duration_seconds = t.s
    from (select coalesce(sum(e.count), 0)::int c, coalesce(sum(e.seconds), 0)::int s
            from public.jaap_events e where e.session_id = p_session) t
   where s.id = p_session and (s.count is distinct from t.c or s.duration_seconds is distinct from t.s);
end $$;

create or replace function public.jaap_events_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.jaap_recompute(old.user_id, old.mantra_id, old.local_date, old.session_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and
     (new.user_id, new.mantra_id, new.local_date, new.session_id) is distinct from (old.user_id, old.mantra_id, old.local_date, old.session_id)) then
    perform public.jaap_recompute(new.user_id, new.mantra_id, new.local_date, new.session_id);
  elsif tg_op = 'UPDATE' then
    null; -- same key: already recomputed above
  end if;
  return null;
end $$;
create trigger jaap_events_after after insert or update or delete on public.jaap_events
  for each row execute function public.jaap_events_after();

-- An event always carries its session's owner and mantra, whatever the phone sent.
create or replace function public.jaap_events_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select user_id, mantra_id into s from public.jaap_sessions where id = new.session_id;
  if not found then raise exception 'jaap session % not found', new.session_id; end if;
  new.user_id := s.user_id; new.mantra_id := s.mantra_id; new.updated_at := now();
  return new;
end $$;
create trigger jaap_events_before before insert or update on public.jaap_events
  for each row execute function public.jaap_events_before();

-- A phone can never write a session total that disagrees with its events.
create or replace function public.jaap_sessions_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- our own recompute
  select coalesce(sum(e.count), 0), coalesce(sum(e.seconds), 0) into new.count, new.duration_seconds
    from public.jaap_events e where e.session_id = new.id;
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.user_id := old.user_id; end if;
  return new;
end $$;
create trigger jaap_sessions_before before insert or update on public.jaap_sessions
  for each row execute function public.jaap_sessions_before();

-- Correcting a session's mantra moves its repetitions to the other mantra.
create or replace function public.jaap_sessions_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.mantra_id is distinct from old.mantra_id then
    update public.jaap_events set mantra_id = new.mantra_id where session_id = new.id;
  end if;
  return null;
end $$;
create trigger jaap_sessions_after after update of mantra_id on public.jaap_sessions
  for each row execute function public.jaap_sessions_after();

-- ---------------------------------------------------------------- row level security
alter table public.jaap_mantras enable row level security;
alter table public.jaap_sessions enable row level security;
alter table public.jaap_events enable row level security;
alter table public.jaap_daily_progress enable row level security;
alter table public.jaap_goals enable row level security;
alter table public.jaap_reminders enable row level security;
alter table public.jaap_delivery_logs enable row level security;
alter table public.jaap_milestones enable row level security;

create policy jaap_mantras_own on public.jaap_mantras for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy jaap_sessions_own on public.jaap_sessions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and mantra_id in (select id from public.jaap_mantras where user_id = (select auth.uid())));
create policy jaap_events_own on public.jaap_events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (session_id in (select id from public.jaap_sessions where user_id = (select auth.uid())));
create policy jaap_daily_progress_read on public.jaap_daily_progress for select to authenticated
  using (user_id = (select auth.uid()));
create policy jaap_goals_own on public.jaap_goals for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (mantra_id is null or mantra_id in (select id from public.jaap_mantras where user_id = (select auth.uid()))));
create policy jaap_reminders_own on public.jaap_reminders for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (mantra_id is null or mantra_id in (select id from public.jaap_mantras where user_id = (select auth.uid()))));
create policy jaap_delivery_logs_read on public.jaap_delivery_logs for select to authenticated
  using (user_id = (select auth.uid()));
create policy jaap_milestones_own on public.jaap_milestones for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (mantra_id is null or mantra_id in (select id from public.jaap_mantras where user_id = (select auth.uid()))));

revoke all on public.jaap_mantras, public.jaap_sessions, public.jaap_events, public.jaap_daily_progress,
  public.jaap_goals, public.jaap_reminders, public.jaap_delivery_logs, public.jaap_milestones from anon, public;
revoke all on public.jaap_daily_progress, public.jaap_delivery_logs from authenticated;
grant select on public.jaap_daily_progress, public.jaap_delivery_logs to authenticated;
grant select, insert, update, delete on public.jaap_mantras, public.jaap_sessions, public.jaap_events,
  public.jaap_goals, public.jaap_reminders, public.jaap_milestones to authenticated;
revoke all on function public.jaap_recompute(uuid, uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.jaap_events_after(), public.jaap_events_before(), public.jaap_sessions_before(), public.jaap_sessions_after() from public, anon, authenticated;

-- ---------------------------------------------------------------- pause
-- Per-user Naam Jaap settings. paused_until in the future = every Jaap reminder is held back until then.
create table public.jaap_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  paused_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.jaap_settings enable row level security;
create policy jaap_settings_own on public.jaap_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.jaap_settings from anon, public;
grant select, insert, update, delete on public.jaap_settings to authenticated;

-- ---------------------------------------------------------------- scheduler
-- Every minute, ask the `jaap` edge function to send whatever reminders are due.
select cron.schedule('jaap-tick', '* * * * *', $cron$
  select net.http_post(
    url := 'https://ndmkdkvtpbbsiawnuwuv.supabase.co/functions/v1/jaap',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select value from public.sk_secrets where key='cron_key')),
    body := '{"action":"tick"}'::jsonb
  )
$cron$);
