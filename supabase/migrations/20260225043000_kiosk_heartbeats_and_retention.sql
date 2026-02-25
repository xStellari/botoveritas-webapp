-- Kiosk heartbeat audit trail + retention

create extension if not exists pg_cron;

create table if not exists public.kiosk_heartbeats (
  id uuid primary key default gen_random_uuid(),
  kiosk_id text not null,
  heartbeat_at timestamptz not null default now(),
  ip_address text null,
  user_agent text null,
  status text not null default 'OK',
  constraint kiosk_heartbeats_kiosk_fk
    foreign key (kiosk_id)
    references public.kiosk_devices(kiosk_id)
    on delete cascade
);

create index if not exists idx_kiosk_heartbeats_kiosk_id
  on public.kiosk_heartbeats(kiosk_id);

create index if not exists idx_kiosk_heartbeats_heartbeat_at
  on public.kiosk_heartbeats(heartbeat_at);

create index if not exists idx_kiosk_heartbeats_kiosk_time
  on public.kiosk_heartbeats(kiosk_id, heartbeat_at desc);

-- Purge heartbeats older than 7 days
create or replace function public.purge_kiosk_heartbeats()
returns void
language plpgsql
as $$
begin
  delete from public.kiosk_heartbeats
  where heartbeat_at < now() - interval '7 days';
end;
$$;

-- Purge daily secrets older than 30 days (audit retention)
create or replace function public.purge_kiosk_daily_secrets()
returns void
language plpgsql
as $$
begin
  delete from public.kiosk_daily_secrets
  where valid_date < (now() at time zone 'Asia/Manila')::date - interval '30 days';
end;
$$;

do $do$
begin
  -- Hourly heartbeat purge
  perform cron.schedule(
    'purge-kiosk-heartbeats',
    '0 * * * *',
    $cron$select public.purge_kiosk_heartbeats();$cron$
  );

  -- Daily secrets purge at 2AM Asia/Manila (18:00 UTC)
  perform cron.schedule(
    'purge-kiosk-daily-secrets',
    '0 18 * * *',
    $cron$select public.purge_kiosk_daily_secrets();$cron$
  );
exception
  when others then
    -- If schedules already exist or pg_cron isn't available, do not fail migration.
    null;
end;
$do$;
