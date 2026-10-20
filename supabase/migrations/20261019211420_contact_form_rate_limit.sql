create table if not exists public.contact_form_rate_limits (
  bucket_hash text primary key check (bucket_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists contact_form_rate_limits_updated_at_idx
  on public.contact_form_rate_limits (updated_at);

alter table public.contact_form_rate_limits enable row level security;
revoke all on table public.contact_form_rate_limits from public, anon, authenticated;
grant all on table public.contact_form_rate_limits to service_role;

create or replace function public.consume_contact_form_rate_limit(
  p_bucket_hash text,
  p_limit integer default 5,
  p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_bucket_hash is null or p_bucket_hash !~ '^[0-9a-f]{64}$'
     or p_limit < 1 or p_limit > 20
     or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit parameters';
  end if;

  insert into public.contact_form_rate_limits as current_limit
    (bucket_hash, window_started_at, request_count, updated_at)
  values (p_bucket_hash, now(), 1, now())
  on conflict (bucket_hash) do update
    set window_started_at = case
          when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then now()
          else current_limit.window_started_at
        end,
        request_count = case
          when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then 1
          else current_limit.request_count + 1
        end,
        updated_at = now()
  returning request_count into v_count;

  delete from public.contact_form_rate_limits
  where updated_at < now() - interval '7 days'
    and bucket_hash <> p_bucket_hash;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_contact_form_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_contact_form_rate_limit(text, integer, integer) to service_role;
