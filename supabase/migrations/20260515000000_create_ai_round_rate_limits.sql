create table if not exists public.ai_round_request_limits (
  request_key_hash text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (request_key_hash, bucket_start)
);

alter table public.ai_round_request_limits enable row level security;

create or replace function public.consume_ai_round_quota(
  p_request_key_hash text,
  p_bucket_start timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  insert into public.ai_round_request_limits (
    request_key_hash,
    bucket_start,
    request_count,
    updated_at
  )
  values (
    p_request_key_hash,
    p_bucket_start,
    1,
    now()
  )
  on conflict (request_key_hash, bucket_start)
  do update set
    request_count = public.ai_round_request_limits.request_count + 1,
    updated_at = now()
  returning request_count into next_count;

  return next_count <= p_limit;
end;
$$;

revoke all on function public.consume_ai_round_quota(text, timestamptz, integer) from public;
grant execute on function public.consume_ai_round_quota(text, timestamptz, integer) to service_role;
