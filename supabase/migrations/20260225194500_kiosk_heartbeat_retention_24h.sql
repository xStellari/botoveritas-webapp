-- Adjust kiosk heartbeat retention to 24 hours (recommended balance)
-- Keeps enough history for post-election troubleshooting without long-term growth.

create or replace function public.purge_kiosk_heartbeats()
returns void
language plpgsql
as $$
begin
  delete from public.kiosk_heartbeats
  where heartbeat_at < now() - interval '24 hours';
end;
$$;

do $do$
begin
  -- Unschedule existing job if present (ignore if missing)
  begin
    perform cron.unschedule('purge-kiosk-heartbeats');
  exception when others then
    null;
  end;

  -- Run every 15 minutes
  perform cron.schedule(
    'purge-kiosk-heartbeats',
    '*/15 * * * *',
    $cron$select public.purge_kiosk_heartbeats();$cron$
  );
end
$do$;