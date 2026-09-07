-- Harden the public round-generation endpoint with atomic quotas, leases,
-- idempotency, App Attest state, and bounded retention.

create schema if not exists private;
revoke all on schema private from public;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ai_round_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  disabled_until timestamptz,
  attestation_mode text not null default 'observe'
    check (attestation_mode in ('off', 'observe', 'required')),
  attested_hourly_requests_per_key integer not null default 30
    check (attested_hourly_requests_per_key > 0),
  attested_daily_requests_per_key integer not null default 120
    check (attested_daily_requests_per_key > 0),
  attested_daily_model_calls_per_key integer not null default 120
    check (attested_daily_model_calls_per_key > 0),
  attested_concurrency_per_key integer not null default 1
    check (attested_concurrency_per_key > 0),
  legacy_hourly_requests_per_key integer not null default 10
    check (legacy_hourly_requests_per_key > 0),
  legacy_daily_requests_per_key integer not null default 30
    check (legacy_daily_requests_per_key > 0),
  legacy_daily_model_calls_per_key integer not null default 30
    check (legacy_daily_model_calls_per_key > 0),
  legacy_concurrency_per_key integer not null default 2
    check (legacy_concurrency_per_key > 0),
  global_daily_requests integer not null default 2000
    check (global_daily_requests > 0),
  global_daily_model_calls integer not null default 2000
    check (global_daily_model_calls > 0),
  daily_cost_microusd_per_key bigint not null default 25000000
    check (daily_cost_microusd_per_key > 0),
  global_daily_cost_microusd bigint not null default 25000000
    check (global_daily_cost_microusd > 0),
  global_concurrency integer not null default 8
    check (global_concurrency > 0),
  lease_seconds integer not null default 20
    check (lease_seconds between 5 and 300),
  result_ttl_seconds integer not null default 86400
    check (result_ttl_seconds between 60 and 604800),
  failed_ttl_seconds integer not null default 900
    check (failed_ttl_seconds between 30 and 86400),
  -- Also covers recently completed calls because a successful HTTP response
  -- can be lost before a legacy client receives it.
  legacy_provider_cooldown_seconds integer not null default 30
    check (legacy_provider_cooldown_seconds between 0 and 300),
  challenge_ttl_seconds integer not null default 600
    check (challenge_ttl_seconds between 60 and 3600),
  -- Pre-attestation enrollment challenges remain fingerprint-limited.
  challenge_hourly_per_key integer not null default 20
    check (challenge_hourly_per_key > 0),
  challenge_hourly_global integer not null default 2000
    check (challenge_hourly_global > 0),
  outstanding_challenges_per_key integer not null default 5
    check (outstanding_challenges_per_key between 1 and 50),
  allow_development_attest boolean not null default true,
  attestation_enforcement_at timestamptz,
  app_attest_signed_path text not null default '/functions/v1/generate-round'
    check (app_attest_signed_path = '/functions/v1/generate-round'),
  client_usage_retention_days integer not null default 31
    check (client_usage_retention_days between 1 and 400),
  global_usage_retention_days integer not null default 400
    check (global_usage_retention_days between 31 and 1095),
  execution_retention_days integer not null default 7
    check (execution_retention_days between 1 and 90),
  model_call_retention_days integer not null default 7
    check (model_call_retention_days between 1 and 400),
  revoked_key_retention_days integer not null default 90
    check (revoked_key_retention_days between 30 and 400),
  hourly_retention_days integer not null default 31
    check (hourly_retention_days between 1 and 400),
  last_purge_at timestamptz,
  policy_version bigint not null default 1 check (policy_version > 0),
  updated_at timestamptz not null default now()
);

insert into public.ai_round_policy (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.ai_round_usage_daily (
  usage_date date not null,
  scope_type text not null check (scope_type in ('global', 'client')),
  scope_key text not null check (char_length(scope_key) between 1 and 128),
  request_attempts bigint not null default 0 check (request_attempts >= 0),
  accepted_jobs bigint not null default 0 check (accepted_jobs >= 0),
  challenge_issues bigint not null default 0 check (challenge_issues >= 0),
  model_calls_reserved bigint not null default 0 check (model_calls_reserved >= 0),
  model_calls_completed bigint not null default 0 check (model_calls_completed >= 0),
  cost_microusd_reserved bigint not null default 0 check (cost_microusd_reserved >= 0),
  max_output_tokens_reserved bigint not null default 0 check (max_output_tokens_reserved >= 0),
  input_tokens_actual bigint not null default 0 check (input_tokens_actual >= 0),
  output_tokens_actual bigint not null default 0 check (output_tokens_actual >= 0),
  completed_jobs bigint not null default 0 check (completed_jobs >= 0),
  failed_jobs bigint not null default 0 check (failed_jobs >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_date, scope_type, scope_key),
  check (
    (scope_type = 'global' and scope_key = '*') or
    (scope_type = 'client' and scope_key <> '*')
  )
);

create table if not exists public.app_attest_keys (
  key_id_hash text primary key
    check (key_id_hash ~ '^[0-9a-f]{64}$'),
  public_key_base64 text not null check (char_length(public_key_base64) between 32 and 8192),
  receipt_base64 text check (receipt_base64 is null or char_length(receipt_base64) <= 65536),
  bundle_id text not null check (char_length(bundle_id) between 3 and 255),
  team_id text not null check (char_length(team_id) between 3 and 32),
  environment text not null check (environment in ('development', 'production')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  assertion_counter bigint not null default 0 check (assertion_counter >= 0),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 160)
);

create table if not exists public.app_attest_challenges (
  challenge_id uuid primary key default gen_random_uuid(),
  challenge_hash text not null unique check (challenge_hash ~ '^[0-9a-f]{64}$'),
  challenge_value text not null check (challenge_value ~ '^[A-Za-z0-9_-]{43}$'),
  purpose text not null check (purpose in ('attest', 'assert')),
  request_key_hash text not null check (request_key_hash ~ '^[0-9a-f]{64}$'),
  key_id_hash text not null check (key_id_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  signed_path text not null default '/functions/v1/generate-round'
    check (signed_path = '/functions/v1/generate-round'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at),
  check (
    (purpose = 'attest' and payload_hash is null) or
    (purpose = 'assert' and payload_hash is not null)
  ),
  -- A request UUID names exactly one challenge-issuance operation. Looking it
  -- up before counters are consumed makes a lost HTTP/RPC response replayable;
  -- reusing it with any different binding is a conflict.
  unique (idempotency_key)
);

create table if not exists public.ai_round_executions (
  execution_id uuid primary key default gen_random_uuid(),
  request_key_hash text not null check (request_key_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  mode text not null check (mode in ('generate-round', 'translate-word')),
  attestation_class text not null check (attestation_class in ('legacy', 'attested')),
  attest_key_id_hash text references public.app_attest_keys (key_id_hash),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'expired')),
  lease_token uuid not null,
  lease_fence bigint not null default 1 check (lease_fence > 0),
  response jsonb,
  response_expires_at timestamptz,
  error_code text check (
    error_code is null or (char_length(error_code) between 1 and 80 and error_code ~ '^[a-z0-9_]+$')
  ),
  error_expires_at timestamptz,
  usage_date date not null,
  model_calls_reserved integer not null default 0 check (model_calls_reserved >= 0),
  model_calls_completed integer not null default 0 check (model_calls_completed >= 0),
  cost_microusd_reserved bigint not null default 0 check (cost_microusd_reserved >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  retain_until timestamptz not null,
  -- Installation/network identity may legitimately change between transport
  -- retries, so the caller-generated request UUID is the stable global key.
  unique (idempotency_key)
);

create table if not exists public.ai_round_active_leases (
  execution_id uuid primary key references public.ai_round_executions (execution_id) on delete cascade,
  request_key_hash text not null check (request_key_hash ~ '^[0-9a-f]{64}$'),
  lease_token uuid not null,
  lease_fence bigint not null check (lease_fence > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create table if not exists public.ai_model_call_reservations (
  call_id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.ai_round_executions (execution_id) on delete cascade,
  lease_token uuid not null,
  lease_fence bigint not null check (lease_fence > 0),
  stage text not null check (stage in ('generation', 'translation')),
  attempt integer not null check (attempt = 1),
  model text not null check (model in ('gpt-5.4', 'gpt-5.4-mini')),
  reserved_cost_microusd bigint not null check (reserved_cost_microusd > 0),
  max_output_tokens integer not null check (max_output_tokens between 1 and 10000),
  usage_date date not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'completed', 'failed', 'abandoned')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  provider_request_id_hash text check (
    provider_request_id_hash is null or provider_request_id_hash ~ '^[0-9a-f]{64}$'
  ),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (execution_id),
  unique (execution_id, stage, attempt)
);

create index if not exists ai_round_usage_daily_scope_idx
  on public.ai_round_usage_daily (scope_type, scope_key, usage_date desc);
create index if not exists app_attest_challenges_outstanding_idx
  on public.app_attest_challenges (request_key_hash, expires_at)
  where used_at is null;
create index if not exists app_attest_challenges_key_outstanding_idx
  on public.app_attest_challenges (key_id_hash, expires_at)
  where used_at is null;
create index if not exists app_attest_challenges_created_idx
  on public.app_attest_challenges (created_at);
create index if not exists app_attest_challenges_principal_created_idx
  on public.app_attest_challenges (request_key_hash, created_at);
create index if not exists app_attest_challenges_key_created_idx
  on public.app_attest_challenges (key_id_hash, created_at);
create index if not exists app_attest_challenges_expiry_idx
  on public.app_attest_challenges (expires_at);
create index if not exists ai_round_executions_retention_idx
  on public.ai_round_executions (retain_until);
create index if not exists ai_round_executions_response_expiry_idx
  on public.ai_round_executions (response_expires_at)
  where response is not null;
create index if not exists ai_round_executions_status_idx
  on public.ai_round_executions (status, updated_at);
create index if not exists ai_round_executions_legacy_provider_idx
  on public.ai_round_executions (request_key_hash, completed_at desc)
  where attestation_class = 'legacy'
    and status in ('completed', 'failed', 'expired')
    and model_calls_reserved > 0;
create index if not exists ai_round_active_leases_expiry_idx
  on public.ai_round_active_leases (expires_at);
create index if not exists ai_round_active_leases_client_idx
  on public.ai_round_active_leases (request_key_hash, expires_at);
create index if not exists ai_model_call_reservations_started_idx
  on public.ai_model_call_reservations (started_at);
create index if not exists app_attest_keys_revoked_idx
  on public.app_attest_keys (revoked_at)
  where status = 'revoked';

alter table public.ai_round_policy enable row level security;
alter table public.ai_round_usage_daily enable row level security;
alter table public.app_attest_keys enable row level security;
alter table public.app_attest_challenges enable row level security;
alter table public.ai_round_executions enable row level security;
alter table public.ai_round_active_leases enable row level security;
alter table public.ai_model_call_reservations enable row level security;

revoke all on table public.ai_round_policy from public, anon, authenticated;
revoke all on table public.ai_round_usage_daily from public, anon, authenticated;
revoke all on table public.app_attest_keys from public, anon, authenticated;
revoke all on table public.app_attest_challenges from public, anon, authenticated;
revoke all on table public.ai_round_executions from public, anon, authenticated;
revoke all on table public.ai_round_active_leases from public, anon, authenticated;
revoke all on table public.ai_model_call_reservations from public, anon, authenticated;

-- Keep the v1 hourly bucket so the already-submitted client and currently
-- deployed function remain compatible throughout the rollout.
create table if not exists public.ai_round_request_limits (
  request_key_hash text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (request_key_hash, bucket_start)
);

create index if not exists ai_round_request_limits_bucket_idx
  on public.ai_round_request_limits (bucket_start);

alter table public.ai_round_request_limits enable row level security;
revoke all on table public.ai_round_request_limits from public, anon, authenticated;

-- Import existing v1 counts without double-counting if this script is
-- evaluated more than once in a disposable database.
insert into public.ai_round_usage_daily (
  usage_date,
  scope_type,
  scope_key,
  request_attempts,
  updated_at
)
select
  (bucket_start at time zone 'UTC')::date,
  'client',
  'legacy:' || request_key_hash,
  sum(request_count),
  max(updated_at)
from public.ai_round_request_limits
group by (bucket_start at time zone 'UTC')::date, request_key_hash
on conflict (usage_date, scope_type, scope_key) do update
set request_attempts = greatest(
      public.ai_round_usage_daily.request_attempts,
      excluded.request_attempts
    ),
    updated_at = greatest(public.ai_round_usage_daily.updated_at, excluded.updated_at);

insert into public.ai_round_usage_daily (
  usage_date,
  scope_type,
  scope_key,
  request_attempts,
  updated_at
)
select
  (bucket_start at time zone 'UTC')::date,
  'global',
  '*',
  sum(request_count),
  max(updated_at)
from public.ai_round_request_limits
group by (bucket_start at time zone 'UTC')::date
on conflict (usage_date, scope_type, scope_key) do update
set request_attempts = greatest(
      public.ai_round_usage_daily.request_attempts,
      excluded.request_attempts
    ),
    updated_at = greatest(public.ai_round_usage_daily.updated_at, excluded.updated_at);

create or replace function private.ai_utc_date(p_now timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_now at time zone 'UTC')::date;
$$;

create or replace function private.ai_sha256_hex(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

create or replace function private.ai_base64url(p_value bytea)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.rtrim(
    pg_catalog.translate(pg_catalog.encode(p_value, 'base64'), '+/', '-_'),
    '='
  );
$$;

create or replace function private.ai_ensure_usage_rows(
  p_usage_date date,
  p_request_key_hash text,
  p_attestation_class text,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ai_round_usage_daily (
    usage_date,
    scope_type,
    scope_key,
    updated_at
  ) values
    (p_usage_date, 'global', '*', p_now),
    (p_usage_date, 'client', p_attestation_class || ':' || p_request_key_hash, p_now)
  on conflict (usage_date, scope_type, scope_key) do nothing;
end;
$$;

create or replace function private.ai_expire_leases(
  p_now timestamptz,
  p_execution_retention_days integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
begin
  update public.ai_model_call_reservations as model_call
  set status = 'abandoned',
      finished_at = p_now
  from public.ai_round_active_leases as lease
  where lease.expires_at <= p_now
    and lease.execution_id = model_call.execution_id
    and model_call.status = 'reserved';

  update public.ai_round_executions as execution
  set status = 'expired',
      error_code = 'lease_expired',
      updated_at = p_now,
      completed_at = lease.expires_at,
      retain_until = greatest(
        execution.retain_until,
        p_now + pg_catalog.make_interval(days => p_execution_retention_days)
      )
  from public.ai_round_active_leases as lease
  where lease.expires_at <= p_now
    and lease.execution_id = execution.execution_id
    and execution.status = 'running';

  delete from public.ai_round_active_leases
  where expires_at <= p_now;
  get diagnostics v_expired = row_count;

  return v_expired;
end;
$$;

create or replace function private.ai_retry_after_day(p_now timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    1,
    ceil(
      extract(
        epoch from (
          ((private.ai_utc_date(p_now) + 1)::timestamp at time zone 'UTC') - p_now
        )
      )
    )::integer
  );
$$;

create or replace function private.ai_retry_after_hour(p_bucket_start timestamptz, p_now timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    1,
    ceil(extract(epoch from ((p_bucket_start + interval '1 hour') - p_now)))::integer
  );
$$;

create or replace function private.ai_validate_assertion(
  p_idempotency_key text,
  p_payload_hash text,
  p_key_id_hash text,
  p_challenge_id uuid,
  p_challenge text,
  p_previous_counter bigint,
  p_new_counter bigint,
  p_signed_path text,
  p_allow_development boolean,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.app_attest_challenges%rowtype;
  v_key public.app_attest_keys%rowtype;
begin
  if p_key_id_hash is null
    or p_challenge_id is null
    or p_challenge is null
    or p_previous_counter is null
    or p_new_counter is null
    or p_new_counter <= p_previous_counter then
    return false;
  end if;

  select *
  into v_challenge
  from public.app_attest_challenges
  where challenge_id = p_challenge_id
  for update;

  if not found
    or v_challenge.used_at is not null
    or v_challenge.expires_at <= p_now
    or v_challenge.purpose <> 'assert'
    -- Assertion challenges are bound to the verified App Attest key rather
    -- than an unstable network fingerprint.
    or v_challenge.request_key_hash <> p_key_id_hash
    or v_challenge.key_id_hash <> p_key_id_hash
    or v_challenge.payload_hash <> p_payload_hash
    or v_challenge.idempotency_key <> p_idempotency_key
    or v_challenge.signed_path <> p_signed_path
    or v_challenge.challenge_hash <> private.ai_sha256_hex(p_challenge) then
    return false;
  end if;

  select *
  into v_key
  from public.app_attest_keys
  where key_id_hash = p_key_id_hash
  for update;

  if not found
    or v_key.status <> 'active'
    or (v_key.environment = 'development' and not p_allow_development)
    -- Edge may have read the counter before another genuine assertion
    -- committed. The signed counter itself is authoritative and must advance
    -- the currently locked database value; equal/lower values remain replays.
    or p_previous_counter > v_key.assertion_counter
    or p_new_counter <= v_key.assertion_counter then
    return false;
  end if;

  return true;
end;
$$;

create or replace function private.ai_purge_round_control_internal(
  p_now timestamptz,
  p_batch_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_responses integer := 0;
  v_challenges integer := 0;
  v_calls integer := 0;
  v_executions integer := 0;
  v_revoked_keys integer := 0;
  v_client_usage integer := 0;
  v_global_usage integer := 0;
  v_hourly integer := 0;
begin
  select * into v_policy
  from public.ai_round_policy
  where singleton;

  perform private.ai_expire_leases(p_now, v_policy.execution_retention_days);

  update public.ai_round_executions
  set response = null,
      updated_at = p_now
  where execution_id in (
    select execution_id
    from public.ai_round_executions
    where response is not null
      and response_expires_at <= p_now
    order by response_expires_at
    limit p_batch_size
  );
  get diagnostics v_responses = row_count;

  delete from public.app_attest_challenges
  where challenge_id in (
    select challenge_id
    from public.app_attest_challenges
    where expires_at < p_now - interval '1 day'
    order by expires_at
    limit p_batch_size
  );
  get diagnostics v_challenges = row_count;

  delete from public.ai_model_call_reservations
  where call_id in (
    select model_call.call_id
    from public.ai_model_call_reservations as model_call
    join public.ai_round_executions as execution
      on execution.execution_id = model_call.execution_id
    where model_call.started_at < p_now - make_interval(days => v_policy.model_call_retention_days)
      and execution.retain_until <= p_now
    order by model_call.started_at
    limit p_batch_size
  );
  get diagnostics v_calls = row_count;

  delete from public.ai_round_executions
  where execution_id in (
    select execution.execution_id
    from public.ai_round_executions as execution
    left join public.ai_round_active_leases as lease
      on lease.execution_id = execution.execution_id
    where execution.retain_until <= p_now
      and lease.execution_id is null
    order by execution.retain_until
    limit p_batch_size
  );
  get diagnostics v_executions = row_count;

  delete from public.app_attest_keys
  where key_id_hash in (
    select key.key_id_hash
    from public.app_attest_keys as key
    where key.status = 'revoked'
      and key.revoked_at < p_now - make_interval(days => v_policy.revoked_key_retention_days)
      and not exists (
        select 1
        from public.ai_round_executions as execution
        where execution.attest_key_id_hash = key.key_id_hash
      )
    order by key.revoked_at
    limit p_batch_size
  );
  get diagnostics v_revoked_keys = row_count;

  delete from public.ai_round_usage_daily
  where (usage_date, scope_type, scope_key) in (
    select usage_date, scope_type, scope_key
    from public.ai_round_usage_daily
    where scope_type = 'client'
      and usage_date < private.ai_utc_date(p_now) - v_policy.client_usage_retention_days
    order by usage_date
    limit p_batch_size
  );
  get diagnostics v_client_usage = row_count;

  delete from public.ai_round_usage_daily
  where (usage_date, scope_type, scope_key) in (
    select usage_date, scope_type, scope_key
    from public.ai_round_usage_daily
    where scope_type = 'global'
      and usage_date < private.ai_utc_date(p_now) - v_policy.global_usage_retention_days
    order by usage_date
    limit p_batch_size
  );
  get diagnostics v_global_usage = row_count;

  delete from public.ai_round_request_limits
  where (request_key_hash, bucket_start) in (
    select request_key_hash, bucket_start
    from public.ai_round_request_limits
    where bucket_start < p_now - make_interval(days => v_policy.hourly_retention_days)
    order by bucket_start
    limit p_batch_size
  );
  get diagnostics v_hourly = row_count;

  return jsonb_build_object(
    'status', 'purged',
    'responses', v_responses,
    'challenges', v_challenges,
    'model_call_reservations', v_calls,
    'executions', v_executions,
    'revoked_keys', v_revoked_keys,
    'client_usage_rows', v_client_usage,
    'global_usage_rows', v_global_usage,
    'legacy_hourly_rows', v_hourly
  );
end;
$$;

create or replace function private.ai_maybe_purge_round_control(p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_purge_at timestamptz;
begin
  select last_purge_at
  into v_last_purge_at
  from public.ai_round_policy
  where singleton;

  -- A 5,000-row batch every five minutes has far more capacity than the
  -- admitted maximum of 48,000 challenges/day while bounding request latency.
  if v_last_purge_at is not null and v_last_purge_at > p_now - interval '5 minutes' then
    return false;
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('ai_round_retention_purge', 0)
  ) then
    return false;
  end if;

  begin
    perform private.ai_purge_round_control_internal(p_now, 5000);

    update public.ai_round_policy
    set last_purge_at = p_now,
        updated_at = p_now
    where singleton;

    return true;
  exception when others then
    raise warning 'Opportunistic round-control cleanup failed: %', sqlerrm;
    return false;
  end;
end;
$$;

create or replace function public.issue_ai_app_attest_challenge(
  p_purpose text,
  p_request_key_hash text,
  p_key_id_hash text default null,
  p_payload_hash text default null,
  p_idempotency_key text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_existing_challenge public.app_attest_challenges%rowtype;
  v_usage_date date := private.ai_utc_date(p_now);
  v_attestation_class text;
  v_principal_hash text;
  v_client_scope_key text;
  v_global public.ai_round_usage_daily%rowtype;
  v_client public.ai_round_usage_daily%rowtype;
  v_challenge text;
  v_challenge_id uuid := gen_random_uuid();
  v_expires_at timestamptz;
  v_outstanding integer;
  v_hourly_issued integer;
  v_hourly_challenge_limit integer;
  v_hourly_global integer;
  v_hour_bucket timestamptz := date_trunc('hour', p_now at time zone 'UTC') at time zone 'UTC';
begin
  if p_purpose not in ('attest', 'assert')
    or p_request_key_hash is null
    or p_request_key_hash !~ '^[0-9a-f]{64}$'
    or p_key_id_hash is null
    or p_key_id_hash !~ '^[0-9a-f]{64}$'
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 128
    or (p_purpose = 'attest' and p_payload_hash is not null)
    or (p_purpose = 'assert' and (
      p_payload_hash is null
      or p_payload_hash !~ '^[0-9a-f]{64}$'
    )) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select *
  into v_policy
  from public.ai_round_policy
  where singleton
  for update;

  perform private.ai_maybe_purge_round_control(p_now);

  if not v_policy.enabled
    or (v_policy.disabled_until is not null and v_policy.disabled_until > p_now) then
    return jsonb_build_object(
      'status', 'disabled',
      'retry_after_seconds', case
        when v_policy.disabled_until is null then 60
        else greatest(1, ceil(extract(epoch from (v_policy.disabled_until - p_now)))::integer)
      end
    );
  end if;

  -- Registration is not trusted yet, so its principal remains the salted
  -- legacy fingerprint. Assertion challenges use the already-registered App
  -- Attest key as their stable principal across network changes.
  v_attestation_class := case when p_purpose = 'assert' then 'attested' else 'legacy' end;
  v_principal_hash := case when p_purpose = 'assert' then p_key_id_hash else p_request_key_hash end;
  v_client_scope_key := v_attestation_class || ':' || v_principal_hash;
  v_hourly_challenge_limit := case
    when p_purpose = 'assert' then v_policy.attested_hourly_requests_per_key
    else v_policy.challenge_hourly_per_key
  end;

  -- Return the exact same random challenge after a lost transport response.
  -- This lookup deliberately precedes challenge quotas and outstanding counts.
  select *
  into v_existing_challenge
  from public.app_attest_challenges
  where idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing_challenge.purpose <> p_purpose
      -- Enrollment request IDs remain replayable across a normal network
      -- change; the original fingerprint keeps the one-time quota charge.
      or (
        p_purpose = 'assert'
        and v_existing_challenge.request_key_hash <> v_principal_hash
      )
      or v_existing_challenge.key_id_hash <> p_key_id_hash
      or v_existing_challenge.payload_hash is distinct from p_payload_hash
      or v_existing_challenge.signed_path <> v_policy.app_attest_signed_path then
      return jsonb_build_object('status', 'conflict');
    end if;

    if v_existing_challenge.expires_at <= p_now then
      return jsonb_build_object(
        'status', 'idempotency_expired',
        'challenge_id', v_existing_challenge.challenge_id
      );
    end if;

    return jsonb_build_object(
      'status', 'issued',
      'challenge_id', v_existing_challenge.challenge_id,
      'challenge', v_existing_challenge.challenge_value,
      'expiresAt', v_existing_challenge.expires_at,
      'expires_at', v_existing_challenge.expires_at,
      'signed_path', v_existing_challenge.signed_path,
      'duplicate', true
    );
  end if;

  if p_purpose = 'assert' and not exists (
    select 1
    from public.app_attest_keys
    where key_id_hash = p_key_id_hash
      and status = 'active'
      and (environment = 'production' or v_policy.allow_development_attest)
  ) then
    return jsonb_build_object('status', 'attestation_invalid');
  end if;

  perform private.ai_ensure_usage_rows(
    v_usage_date,
    v_principal_hash,
    v_attestation_class,
    p_now
  );

  select * into v_global
  from public.ai_round_usage_daily
  where usage_date = v_usage_date and scope_type = 'global' and scope_key = '*'
  for update;

  select * into v_client
  from public.ai_round_usage_daily
  where usage_date = v_usage_date
    and scope_type = 'client'
    and scope_key = v_client_scope_key
  for update;

  select count(*)::integer
  into v_hourly_issued
  from public.app_attest_challenges
  where (request_key_hash = v_principal_hash or key_id_hash = p_key_id_hash)
    and created_at >= v_hour_bucket
    and created_at < v_hour_bucket + interval '1 hour';

  if v_hourly_issued >= v_hourly_challenge_limit then
    return jsonb_build_object(
      'status', 'rate_limited',
      'scope', case
        when p_purpose = 'assert' then 'attested_hourly_challenges'
        else 'principal_or_key_hourly_challenges'
      end,
      'retry_after_seconds', private.ai_retry_after_hour(v_hour_bucket, p_now)
    );
  end if;

  select count(*)::integer
  into v_hourly_global
  from public.app_attest_challenges
  where created_at >= v_hour_bucket
    and created_at < v_hour_bucket + interval '1 hour';

  if v_hourly_global >= v_policy.challenge_hourly_global then
    return jsonb_build_object(
      'status', 'rate_limited',
      'scope', 'global_hourly_challenges',
      'retry_after_seconds', private.ai_retry_after_hour(v_hour_bucket, p_now)
    );
  end if;

  select count(*)::integer
  into v_outstanding
  from public.app_attest_challenges
  where (request_key_hash = v_principal_hash or key_id_hash = p_key_id_hash)
    and used_at is null
    and expires_at > p_now;

  if v_outstanding >= v_policy.outstanding_challenges_per_key then
    return jsonb_build_object(
      'status', 'challenge_limited',
      'retry_after_seconds', v_policy.challenge_ttl_seconds
    );
  end if;

  v_challenge := private.ai_base64url(extensions.gen_random_bytes(32));
  v_expires_at := p_now + make_interval(secs => v_policy.challenge_ttl_seconds);

  insert into public.app_attest_challenges (
    challenge_id,
    challenge_hash,
    challenge_value,
    purpose,
    request_key_hash,
    key_id_hash,
    payload_hash,
    idempotency_key,
    signed_path,
    created_at,
    expires_at
  ) values (
    v_challenge_id,
    private.ai_sha256_hex(v_challenge),
    v_challenge,
    p_purpose,
    v_principal_hash,
    p_key_id_hash,
    p_payload_hash,
    p_idempotency_key,
    v_policy.app_attest_signed_path,
    p_now,
    v_expires_at
  );

  update public.ai_round_usage_daily
  set challenge_issues = challenge_issues + 1,
      updated_at = p_now
  where usage_date = v_usage_date
    and (
      (scope_type = 'global' and scope_key = '*') or
      (scope_type = 'client' and scope_key = v_client_scope_key)
    );

  return jsonb_build_object(
    'status', 'issued',
    'challenge_id', v_challenge_id,
    'challenge', v_challenge,
    'expiresAt', v_expires_at,
    'expires_at', v_expires_at,
    'signed_path', v_policy.app_attest_signed_path,
    'duplicate', false
  );
end;
$$;

create or replace function public.register_ai_app_attest_key(
  p_key_id_hash text,
  p_public_key_base64 text,
  p_receipt_base64 text,
  p_bundle_id text,
  p_team_id text,
  p_environment text,
  p_challenge_id uuid,
  p_challenge text,
  p_request_key_hash text,
  p_idempotency_key text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_challenge public.app_attest_challenges%rowtype;
  v_key public.app_attest_keys%rowtype;
  v_assertion_counter bigint;
begin
  if p_key_id_hash is null or p_key_id_hash !~ '^[0-9a-f]{64}$'
    or p_request_key_hash is null or p_request_key_hash !~ '^[0-9a-f]{64}$'
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 128
    or p_environment not in ('development', 'production')
    or p_public_key_base64 is null or char_length(p_public_key_base64) not between 32 and 8192
    or (p_receipt_base64 is not null and char_length(p_receipt_base64) > 65536)
    or p_bundle_id is null or char_length(p_bundle_id) not between 3 and 255
    or p_team_id is null or char_length(p_team_id) not between 3 and 32 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into v_policy
  from public.ai_round_policy
  where singleton
  for update;

  perform private.ai_maybe_purge_round_control(p_now);

  if not v_policy.enabled
    or (v_policy.disabled_until is not null and v_policy.disabled_until > p_now) then
    return jsonb_build_object('status', 'disabled');
  end if;

  if p_environment = 'development' and not v_policy.allow_development_attest then
    return jsonb_build_object('status', 'attestation_invalid');
  end if;

  select * into v_challenge
  from public.app_attest_challenges
  where challenge_id = p_challenge_id
  for update;

  if not found
    or v_challenge.expires_at <= p_now
    or v_challenge.purpose <> 'attest'
    -- The issue-time fingerprint remains stored for quota/accounting, but a
    -- normal network change must not invalidate a cryptographically bound
    -- challenge during the registration POST.
    or v_challenge.key_id_hash <> p_key_id_hash
    or v_challenge.idempotency_key <> p_idempotency_key
    or v_challenge.signed_path <> v_policy.app_attest_signed_path
    or v_challenge.challenge_hash <> private.ai_sha256_hex(p_challenge) then
    return jsonb_build_object('status', 'attestation_invalid');
  end if;

  select * into v_key
  from public.app_attest_keys
  where key_id_hash = p_key_id_hash
  for update;

  if v_challenge.used_at is not null then
    if found
      and v_key.status = 'active'
      and v_key.public_key_base64 = p_public_key_base64
      and v_key.receipt_base64 is not distinct from p_receipt_base64
      and v_key.bundle_id = p_bundle_id
      and v_key.team_id = p_team_id
      and v_key.environment = p_environment then
      return jsonb_build_object(
        'status', 'registered',
        'key_id_hash', p_key_id_hash,
        'assertion_counter', v_key.assertion_counter,
        'duplicate', true
      );
    end if;

    return jsonb_build_object('status', 'attestation_invalid');
  end if;

  if found and v_key.status = 'revoked' then
    return jsonb_build_object('status', 'key_revoked');
  end if;

  if found and (
    v_key.public_key_base64 <> p_public_key_base64
    or v_key.bundle_id <> p_bundle_id
    or v_key.team_id <> p_team_id
    or v_key.environment <> p_environment
  ) then
    return jsonb_build_object('status', 'conflict');
  end if;

  insert into public.app_attest_keys (
    key_id_hash,
    public_key_base64,
    receipt_base64,
    bundle_id,
    team_id,
    environment,
    status,
    assertion_counter,
    created_at,
    last_seen_at
  ) values (
    p_key_id_hash,
    p_public_key_base64,
    p_receipt_base64,
    p_bundle_id,
    p_team_id,
    p_environment,
    'active',
    0,
    p_now,
    p_now
  )
  on conflict (key_id_hash) do update
  set receipt_base64 = excluded.receipt_base64,
      last_seen_at = excluded.last_seen_at
  returning assertion_counter into v_assertion_counter;

  update public.app_attest_challenges
  set used_at = p_now
  where challenge_id = p_challenge_id;

  return jsonb_build_object(
    'status', 'registered',
    'key_id_hash', p_key_id_hash,
    'assertion_counter', v_assertion_counter,
    'duplicate', false
  );
end;
$$;

create or replace function public.revoke_ai_app_attest_key(
  p_key_id_hash text,
  p_reason text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_key_id_hash is null
    or p_key_id_hash !~ '^[0-9a-f]{64}$'
    or (p_reason is not null and char_length(p_reason) > 160) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  update public.app_attest_keys
  set status = 'revoked',
      revoked_at = p_now,
      revoke_reason = nullif(trim(p_reason), ''),
      last_seen_at = p_now
  where key_id_hash = p_key_id_hash
    and status <> 'revoked';
  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'status', case when v_updated = 1 then 'revoked' else 'not_found_or_already_revoked' end
  );
end;
$$;

-- Admission contract used by the Edge handler. Every non-error return has a
-- stable `status` discriminator; no external call is made while this database
-- transaction is open.
create or replace function public.begin_ai_round_request(
  p_request_key_hash text,
  p_idempotency_key text,
  p_payload_hash text,
  p_mode text,
  p_attest_key_id_hash text default null,
  p_attest_challenge_id uuid default null,
  p_attest_challenge text default null,
  p_attest_previous_counter bigint default null,
  p_attest_new_counter bigint default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_usage_date date := private.ai_utc_date(p_now);
  v_hour_bucket timestamptz := date_trunc('hour', p_now at time zone 'UTC') at time zone 'UTC';
  v_global public.ai_round_usage_daily%rowtype;
  v_client public.ai_round_usage_daily%rowtype;
  v_existing public.ai_round_executions%rowtype;
  v_existing_lease public.ai_round_active_leases%rowtype;
  v_attestation_class text := 'legacy';
  v_attestation_status text := 'missing';
  v_attestation_provided boolean;
  v_attestation_required boolean;
  v_effective_principal_hash text;
  v_client_scope_key text;
  v_hourly_limit integer;
  v_daily_limit integer;
  v_concurrency_limit integer;
  v_hourly_count integer;
  v_active_global integer;
  v_active_client integer;
  v_execution_id uuid := gen_random_uuid();
  v_lease_token uuid := gen_random_uuid();
  v_lease_expires_at timestamptz;
  v_inflight_until timestamptz;
  v_cooldown_until timestamptz;
begin
  if p_request_key_hash is null
    or p_request_key_hash !~ '^[0-9a-f]{64}$'
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 128
    or p_payload_hash is null
    or p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_mode not in ('generate-round', 'translate-word') then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into v_policy
  from public.ai_round_policy
  where singleton
  for update;

  perform private.ai_maybe_purge_round_control(p_now);

  if not v_policy.enabled
    or (v_policy.disabled_until is not null and v_policy.disabled_until > p_now) then
    return jsonb_build_object(
      'status', 'disabled',
      'retry_after_seconds', case
        when v_policy.disabled_until is null then 60
        else greatest(1, ceil(extract(epoch from (v_policy.disabled_until - p_now)))::integer)
      end
    );
  end if;

  perform private.ai_expire_leases(p_now, v_policy.execution_retention_days);

  -- Idempotency is resolved before one-time App Attest state or quotas are
  -- consumed. This makes a transport retry safe after a lost RPC response.
  select * into v_existing
  from public.ai_round_executions
  where idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.payload_hash <> p_payload_hash or v_existing.mode <> p_mode then
      return jsonb_build_object('status', 'conflict');
    end if;

    if v_existing.status = 'completed'
      and v_existing.response is not null
      and v_existing.response_expires_at > p_now then
      return jsonb_build_object(
        'status', 'completed',
        'execution_id', v_existing.execution_id,
        'response', v_existing.response
      );
    end if;

    if v_existing.status = 'running' then
      select * into v_existing_lease
      from public.ai_round_active_leases
      where execution_id = v_existing.execution_id
        and expires_at > p_now;

      if found then
        return jsonb_build_object(
          'status', 'in_progress',
          'execution_id', v_existing.execution_id,
          'retry_after_seconds', greatest(
            1,
            ceil(extract(epoch from (v_existing_lease.expires_at - p_now)))::integer
          )
        );
      end if;
    end if;

    if v_existing.status = 'failed' and v_existing.error_expires_at > p_now then
      return jsonb_build_object(
        'status', 'failed',
        'execution_id', v_existing.execution_id,
        'error_code', v_existing.error_code
      );
    end if;

    return jsonb_build_object(
      'status', 'idempotency_expired',
      'execution_id', v_existing.execution_id
    );
  end if;

  v_attestation_provided := p_attest_key_id_hash is not null
    or p_attest_challenge_id is not null
    or p_attest_challenge is not null
    or p_attest_previous_counter is not null
    or p_attest_new_counter is not null;
  v_attestation_required := v_policy.attestation_mode = 'required'
    and (
      v_policy.attestation_enforcement_at is null
      or v_policy.attestation_enforcement_at <= p_now
    );

  if v_policy.attestation_mode = 'off' then
    v_attestation_status := 'off';
  elsif v_attestation_provided then
    if private.ai_validate_assertion(
      p_idempotency_key,
      p_payload_hash,
      p_attest_key_id_hash,
      p_attest_challenge_id,
      p_attest_challenge,
      p_attest_previous_counter,
      p_attest_new_counter,
      v_policy.app_attest_signed_path,
      v_policy.allow_development_attest,
      p_now
    ) then
      v_attestation_class := 'attested';
      v_attestation_status := 'valid';
    elsif v_attestation_required then
      return jsonb_build_object('status', 'attestation_invalid');
    else
      v_attestation_status := 'invalid';
    end if;
  elsif v_attestation_required then
    return jsonb_build_object('status', 'attestation_required');
  end if;

  if v_attestation_class = 'attested' then
    v_hourly_limit := v_policy.attested_hourly_requests_per_key;
    v_daily_limit := v_policy.attested_daily_requests_per_key;
    v_concurrency_limit := v_policy.attested_concurrency_per_key;
  else
    v_hourly_limit := v_policy.legacy_hourly_requests_per_key;
    v_daily_limit := v_policy.legacy_daily_requests_per_key;
    v_concurrency_limit := v_policy.legacy_concurrency_per_key;
  end if;

  v_effective_principal_hash := case
    when v_attestation_class = 'attested' then p_attest_key_id_hash
    else p_request_key_hash
  end;
  v_client_scope_key := v_attestation_class || ':' || v_effective_principal_hash;

  if v_attestation_class = 'legacy' then
    select max(lease.expires_at)
    into v_inflight_until
    from public.ai_round_executions as execution
    join public.ai_round_active_leases as lease
      on lease.execution_id = execution.execution_id
    where lease.request_key_hash = v_effective_principal_hash
      and execution.request_key_hash = v_effective_principal_hash
      and execution.attestation_class = 'legacy'
      and execution.status = 'running'
      and execution.model_calls_reserved > 0
      and lease.expires_at > p_now;

    if v_inflight_until is not null then
      return jsonb_build_object(
        'status', 'rate_limited',
        'scope', 'legacy_provider_inflight',
        'retry_after_seconds', greatest(
          1,
          ceil(extract(epoch from (v_inflight_until - p_now)))::integer
        )
      );
    end if;

    if v_policy.legacy_provider_cooldown_seconds > 0 then
      -- A completed response can still be lost between server completion and
      -- client receipt. Treat that delivery window as uncertain for legacy
      -- clients that generate a fresh UUID on retry.
      select max(execution.completed_at) + make_interval(secs => v_policy.legacy_provider_cooldown_seconds)
      into v_cooldown_until
      from public.ai_round_executions as execution
      where execution.request_key_hash = v_effective_principal_hash
        and execution.attestation_class = 'legacy'
        and execution.status = 'completed'
        and execution.model_calls_reserved > 0
        and execution.completed_at > p_now - make_interval(secs => v_policy.legacy_provider_cooldown_seconds);

      if v_cooldown_until is not null and v_cooldown_until > p_now then
        return jsonb_build_object(
          'status', 'rate_limited',
          'scope', 'legacy_provider_completion_cooldown',
          'retry_after_seconds', greatest(
            1,
            ceil(extract(epoch from (v_cooldown_until - p_now)))::integer
          )
        );
      end if;

      select max(execution.completed_at) + make_interval(secs => v_policy.legacy_provider_cooldown_seconds)
      into v_cooldown_until
      from public.ai_round_executions as execution
      where execution.request_key_hash = v_effective_principal_hash
        and execution.attestation_class = 'legacy'
        and execution.status in ('failed', 'expired')
        and execution.model_calls_reserved > 0
        and execution.error_code in ('provider_timeout', 'provider_failure', 'lease_expired')
        and execution.completed_at > p_now - make_interval(secs => v_policy.legacy_provider_cooldown_seconds);

      if v_cooldown_until is not null and v_cooldown_until > p_now then
        return jsonb_build_object(
          'status', 'rate_limited',
          'scope', 'legacy_provider_failure_cooldown',
          'retry_after_seconds', greatest(
            1,
            ceil(extract(epoch from (v_cooldown_until - p_now)))::integer
          )
        );
      end if;
    end if;
  end if;

  perform private.ai_ensure_usage_rows(
    v_usage_date,
    v_effective_principal_hash,
    v_attestation_class,
    p_now
  );

  select * into v_global
  from public.ai_round_usage_daily
  where usage_date = v_usage_date and scope_type = 'global' and scope_key = '*'
  for update;

  select * into v_client
  from public.ai_round_usage_daily
  where usage_date = v_usage_date
    and scope_type = 'client'
    and scope_key = v_client_scope_key
  for update;

  if v_global.request_attempts >= v_policy.global_daily_requests then
    return jsonb_build_object(
      'status', 'rate_limited',
      'scope', 'global_daily_requests',
      'retry_after_seconds', private.ai_retry_after_day(p_now)
    );
  end if;

  if v_client.request_attempts >= v_daily_limit then
    return jsonb_build_object(
      'status', 'rate_limited',
      'scope', v_attestation_class || '_daily_requests',
      'retry_after_seconds', private.ai_retry_after_day(p_now)
    );
  end if;

  insert into public.ai_round_request_limits (
    request_key_hash,
    bucket_start,
    request_count,
    updated_at
  ) values (
    v_effective_principal_hash,
    v_hour_bucket,
    0,
    p_now
  )
  on conflict (request_key_hash, bucket_start) do nothing;

  select request_count
  into v_hourly_count
  from public.ai_round_request_limits
  where request_key_hash = v_effective_principal_hash
    and bucket_start = v_hour_bucket
  for update;

  if v_hourly_count >= v_hourly_limit then
    return jsonb_build_object(
      'status', 'rate_limited',
      'scope', v_attestation_class || '_hourly_requests',
      'retry_after_seconds', private.ai_retry_after_hour(v_hour_bucket, p_now)
    );
  end if;

  update public.ai_round_request_limits
  set request_count = request_count + 1,
      updated_at = p_now
  where request_key_hash = v_effective_principal_hash
    and bucket_start = v_hour_bucket;

  update public.ai_round_usage_daily
  set request_attempts = request_attempts + 1,
      updated_at = p_now
  where usage_date = v_usage_date
    and (
      (scope_type = 'global' and scope_key = '*') or
      (scope_type = 'client' and scope_key = v_client_scope_key)
    );

  select count(*)::integer
  into v_active_global
  from public.ai_round_active_leases
  where expires_at > p_now;

  if v_active_global >= v_policy.global_concurrency then
    return jsonb_build_object(
      'status', 'concurrency_limited',
      'scope', 'global',
      'retry_after_seconds', v_policy.lease_seconds
    );
  end if;

  select count(*)::integer
  into v_active_client
  from public.ai_round_active_leases as lease
  join public.ai_round_executions as execution
    on execution.execution_id = lease.execution_id
  where lease.request_key_hash = v_effective_principal_hash
    and lease.expires_at > p_now
    and execution.attestation_class = v_attestation_class;

  if v_active_client >= v_concurrency_limit then
    return jsonb_build_object(
      'status', 'concurrency_limited',
      'scope', v_attestation_class,
      'retry_after_seconds', v_policy.lease_seconds
    );
  end if;

  -- Commit the one-time assertion only after all admission checks pass. The
  -- validation helper locked both rows, so the counter/challenge cannot race.
  if v_attestation_class = 'attested' then
    update public.app_attest_challenges
    set used_at = p_now
    where challenge_id = p_attest_challenge_id;

    update public.app_attest_keys
    set assertion_counter = p_attest_new_counter,
        last_seen_at = p_now
    where key_id_hash = p_attest_key_id_hash;
  end if;

  v_lease_expires_at := p_now + make_interval(secs => v_policy.lease_seconds);

  insert into public.ai_round_executions (
    execution_id,
    request_key_hash,
    idempotency_key,
    payload_hash,
    mode,
    attestation_class,
    attest_key_id_hash,
    status,
    lease_token,
    lease_fence,
    usage_date,
    created_at,
    updated_at,
    retain_until
  ) values (
    v_execution_id,
    v_effective_principal_hash,
    p_idempotency_key,
    p_payload_hash,
    p_mode,
    v_attestation_class,
    case when v_attestation_class = 'attested' then p_attest_key_id_hash else null end,
    'running',
    v_lease_token,
    1,
    v_usage_date,
    p_now,
    p_now,
    p_now + make_interval(days => v_policy.execution_retention_days)
  );

  insert into public.ai_round_active_leases (
    execution_id,
    request_key_hash,
    lease_token,
    lease_fence,
    created_at,
    expires_at
  ) values (
    v_execution_id,
    v_effective_principal_hash,
    v_lease_token,
    1,
    p_now,
    v_lease_expires_at
  );

  update public.ai_round_usage_daily
  set accepted_jobs = accepted_jobs + 1,
      updated_at = p_now
  where usage_date = v_usage_date
    and (
      (scope_type = 'global' and scope_key = '*') or
      (scope_type = 'client' and scope_key = v_client_scope_key)
    );

  return jsonb_build_object(
    'status', 'accepted',
    'execution_id', v_execution_id,
    'lease_token', v_lease_token,
    'lease_fence', 1,
    'lease_expires_at', v_lease_expires_at,
    'attestation_class', v_attestation_class,
    'attestation_status', v_attestation_status,
    'policy_version', v_policy.policy_version
  );
end;
$$;

-- `p_call_units` is a conservative micro-USD reservation computed by the Edge
-- handler from its allowlisted model prices and bounded token caps. The default
-- policy permits at most $25/day globally and per client scope; request/model
-- count limits remain the normal per-client availability controls.
create or replace function public.reserve_ai_model_call(
  p_execution_id uuid,
  p_lease_token uuid,
  p_lease_fence bigint,
  p_stage text,
  p_attempt integer,
  p_model text,
  p_call_units bigint,
  p_max_output_tokens integer,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_execution public.ai_round_executions%rowtype;
  v_lease public.ai_round_active_leases%rowtype;
  v_existing public.ai_model_call_reservations%rowtype;
  v_usage_date date := private.ai_utc_date(p_now);
  v_global public.ai_round_usage_daily%rowtype;
  v_client public.ai_round_usage_daily%rowtype;
  v_client_scope_key text;
  v_client_model_limit integer;
  v_call_id uuid := gen_random_uuid();
  v_lease_expires_at timestamptz;
  v_legacy_block_until timestamptz;
begin
  if p_execution_id is null
    or p_lease_token is null
    or p_lease_fence is null
    or p_lease_fence <= 0
    or p_stage not in ('generation', 'translation')
    or p_attempt <> 1
    or p_model not in ('gpt-5.4', 'gpt-5.4-mini')
    or p_call_units is null
    or p_call_units <= 0
    or p_call_units > 25000000
    or p_max_output_tokens is null
    or p_max_output_tokens not between 1 and 10000 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into v_policy
  from public.ai_round_policy
  where singleton
  for update;

  if not v_policy.enabled
    or (v_policy.disabled_until is not null and v_policy.disabled_until > p_now) then
    return jsonb_build_object('status', 'disabled');
  end if;

  perform private.ai_expire_leases(p_now, v_policy.execution_retention_days);

  select * into v_execution
  from public.ai_round_executions
  where execution_id = p_execution_id
  for update;

  select * into v_lease
  from public.ai_round_active_leases
  where execution_id = p_execution_id
  for update;

  if v_execution.execution_id is null
    or v_execution.status <> 'running'
    or v_lease.execution_id is null
    or v_lease.expires_at <= p_now
    or v_execution.lease_token <> p_lease_token
    or v_execution.lease_fence <> p_lease_fence
    or v_lease.lease_token <> p_lease_token
    or v_lease.lease_fence <> p_lease_fence then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  if (v_execution.mode = 'generate-round' and p_stage <> 'generation')
    or (v_execution.mode = 'translate-word' and p_stage <> 'translation') then
    return jsonb_build_object('status', 'conflict');
  end if;

  select * into v_existing
  from public.ai_model_call_reservations
  where execution_id = p_execution_id
  for update;

  if found then
    if v_existing.stage <> p_stage
      or v_existing.attempt <> p_attempt
      or v_existing.model <> p_model
      or v_existing.reserved_cost_microusd <> p_call_units
      or v_existing.max_output_tokens <> p_max_output_tokens then
      return jsonb_build_object('status', 'conflict');
    end if;

    return jsonb_build_object(
      'status', 'already_reserved',
      'call_id', v_existing.call_id,
      'reservation_status', v_existing.status,
      'lease_expires_at', v_lease.expires_at
    );
  end if;

  -- Two legacy executions may be admitted for non-provider work, but the
  -- serialized reservation transaction permits only one paid/uncertain call
  -- per legacy principal. This closes the begin-before-reserve race.
  if v_execution.attestation_class = 'legacy' then
    select max(other_lease.expires_at)
    into v_legacy_block_until
    from public.ai_round_executions as other_execution
    join public.ai_round_active_leases as other_lease
      on other_lease.execution_id = other_execution.execution_id
    where other_lease.request_key_hash = v_execution.request_key_hash
      and other_execution.request_key_hash = v_execution.request_key_hash
      and other_execution.execution_id <> p_execution_id
      and other_execution.attestation_class = 'legacy'
      and other_execution.status = 'running'
      and other_execution.model_calls_reserved > 0
      and other_lease.expires_at > p_now;

    if v_legacy_block_until is not null then
      return jsonb_build_object(
        'status', 'quota_exhausted',
        'scope', 'legacy_provider_inflight',
        'retry_after_seconds', greatest(
          1,
          ceil(extract(epoch from (v_legacy_block_until - p_now)))::integer
        )
      );
    end if;

    if v_policy.legacy_provider_cooldown_seconds > 0 then
      select max(other_execution.completed_at)
        + make_interval(secs => v_policy.legacy_provider_cooldown_seconds)
      into v_legacy_block_until
      from public.ai_round_executions as other_execution
      where other_execution.request_key_hash = v_execution.request_key_hash
        and other_execution.execution_id <> p_execution_id
        and other_execution.attestation_class = 'legacy'
        and other_execution.status = 'completed'
        and other_execution.model_calls_reserved > 0
        and other_execution.completed_at
          > p_now - make_interval(secs => v_policy.legacy_provider_cooldown_seconds);

      if v_legacy_block_until is not null and v_legacy_block_until > p_now then
        return jsonb_build_object(
          'status', 'quota_exhausted',
          'scope', 'legacy_provider_completion_cooldown',
          'retry_after_seconds', greatest(
            1,
            ceil(extract(epoch from (v_legacy_block_until - p_now)))::integer
          )
        );
      end if;

      select max(other_execution.completed_at)
        + make_interval(secs => v_policy.legacy_provider_cooldown_seconds)
      into v_legacy_block_until
      from public.ai_round_executions as other_execution
      where other_execution.request_key_hash = v_execution.request_key_hash
        and other_execution.execution_id <> p_execution_id
        and other_execution.attestation_class = 'legacy'
        and other_execution.status in ('failed', 'expired')
        and other_execution.model_calls_reserved > 0
        and other_execution.error_code in ('provider_timeout', 'provider_failure', 'lease_expired')
        and other_execution.completed_at
          > p_now - make_interval(secs => v_policy.legacy_provider_cooldown_seconds);

      if v_legacy_block_until is not null and v_legacy_block_until > p_now then
        return jsonb_build_object(
          'status', 'quota_exhausted',
          'scope', 'legacy_provider_failure_cooldown',
          'retry_after_seconds', greatest(
            1,
            ceil(extract(epoch from (v_legacy_block_until - p_now)))::integer
          )
        );
      end if;
    end if;
  end if;

  v_client_scope_key := v_execution.attestation_class || ':' || v_execution.request_key_hash;
  v_client_model_limit := case
    when v_execution.attestation_class = 'attested'
      then v_policy.attested_daily_model_calls_per_key
    else v_policy.legacy_daily_model_calls_per_key
  end;

  perform private.ai_ensure_usage_rows(
    v_usage_date,
    v_execution.request_key_hash,
    v_execution.attestation_class,
    p_now
  );

  select * into v_global
  from public.ai_round_usage_daily
  where usage_date = v_usage_date and scope_type = 'global' and scope_key = '*'
  for update;

  select * into v_client
  from public.ai_round_usage_daily
  where usage_date = v_usage_date
    and scope_type = 'client'
    and scope_key = v_client_scope_key
  for update;

  if v_global.model_calls_reserved >= v_policy.global_daily_model_calls then
    return jsonb_build_object(
      'status', 'quota_exhausted',
      'scope', 'global_daily_model_calls',
      'retry_after_seconds', private.ai_retry_after_day(p_now)
    );
  end if;

  if v_client.model_calls_reserved >= v_client_model_limit then
    return jsonb_build_object(
      'status', 'quota_exhausted',
      'scope', v_execution.attestation_class || '_daily_model_calls',
      'retry_after_seconds', private.ai_retry_after_day(p_now)
    );
  end if;

  if v_global.cost_microusd_reserved + p_call_units > v_policy.global_daily_cost_microusd then
    return jsonb_build_object(
      'status', 'quota_exhausted',
      'scope', 'global_daily_cost_microusd',
      'retry_after_seconds', private.ai_retry_after_day(p_now)
    );
  end if;

  if v_client.cost_microusd_reserved + p_call_units > v_policy.daily_cost_microusd_per_key then
    return jsonb_build_object(
      'status', 'quota_exhausted',
      'scope', v_execution.attestation_class || '_daily_cost_microusd',
      'retry_after_seconds', private.ai_retry_after_day(p_now)
    );
  end if;

  v_lease_expires_at := p_now + make_interval(secs => v_policy.lease_seconds);

  insert into public.ai_model_call_reservations (
    call_id,
    execution_id,
    lease_token,
    lease_fence,
    stage,
    attempt,
    model,
    reserved_cost_microusd,
    max_output_tokens,
    usage_date,
    status,
    started_at
  ) values (
    v_call_id,
    p_execution_id,
    p_lease_token,
    p_lease_fence,
    p_stage,
    p_attempt,
    p_model,
    p_call_units,
    p_max_output_tokens,
    v_usage_date,
    'reserved',
    p_now
  );

  update public.ai_round_executions
  set model_calls_reserved = model_calls_reserved + 1,
      cost_microusd_reserved = cost_microusd_reserved + p_call_units,
      updated_at = p_now
  where execution_id = p_execution_id;

  update public.ai_round_active_leases
  set expires_at = v_lease_expires_at
  where execution_id = p_execution_id;

  update public.ai_round_usage_daily
  set model_calls_reserved = model_calls_reserved + 1,
      cost_microusd_reserved = cost_microusd_reserved + p_call_units,
      max_output_tokens_reserved = max_output_tokens_reserved + p_max_output_tokens,
      updated_at = p_now
  where usage_date = v_usage_date
    and (
      (scope_type = 'global' and scope_key = '*') or
      (scope_type = 'client' and scope_key = v_client_scope_key)
    );

  return jsonb_build_object(
    'status', 'reserved',
    'call_id', v_call_id,
    'duplicate', false,
    'lease_expires_at', v_lease_expires_at
  );
end;
$$;

create or replace function public.record_ai_model_call(
  p_call_id uuid,
  p_execution_id uuid,
  p_lease_token uuid,
  p_lease_fence bigint,
  p_status text,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_provider_request_id_hash text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_execution public.ai_round_executions%rowtype;
  v_lease public.ai_round_active_leases%rowtype;
  v_call public.ai_model_call_reservations%rowtype;
  v_client_scope_key text;
  v_lease_expires_at timestamptz;
begin
  if p_call_id is null
    or p_execution_id is null
    or p_lease_token is null
    or p_lease_fence is null
    or p_lease_fence <= 0
    or p_status not in ('completed', 'failed')
    or (p_input_tokens is not null and p_input_tokens < 0)
    or (p_output_tokens is not null and p_output_tokens < 0)
    or (
      p_provider_request_id_hash is not null
      and p_provider_request_id_hash !~ '^[0-9a-f]{64}$'
    ) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into v_policy
  from public.ai_round_policy
  where singleton
  for update;

  select * into v_execution
  from public.ai_round_executions
  where execution_id = p_execution_id
  for update;

  select * into v_lease
  from public.ai_round_active_leases
  where execution_id = p_execution_id
  for update;

  select * into v_call
  from public.ai_model_call_reservations
  where call_id = p_call_id
    and execution_id = p_execution_id
  for update;

  if v_execution.execution_id is null
    or v_execution.status <> 'running'
    or v_lease.execution_id is null
    or v_lease.expires_at <= p_now
    or v_call.call_id is null
    or v_execution.lease_token <> p_lease_token
    or v_execution.lease_fence <> p_lease_fence
    or v_lease.lease_token <> p_lease_token
    or v_lease.lease_fence <> p_lease_fence
    or v_call.lease_token <> p_lease_token
    or v_call.lease_fence <> p_lease_fence then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  if v_call.status <> 'reserved' then
    if v_call.status = p_status then
      return jsonb_build_object(
        'status', 'recorded',
        'call_id', p_call_id,
        'duplicate', true,
        'lease_expires_at', v_lease.expires_at
      );
    end if;

    return jsonb_build_object('status', 'conflict');
  end if;

  v_client_scope_key := v_execution.attestation_class || ':' || v_execution.request_key_hash;
  v_lease_expires_at := p_now + make_interval(secs => v_policy.lease_seconds);

  update public.ai_model_call_reservations
  set status = p_status,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      provider_request_id_hash = p_provider_request_id_hash,
      finished_at = p_now
  where call_id = p_call_id;

  if p_status = 'completed' then
    update public.ai_round_executions
    set model_calls_completed = model_calls_completed + 1,
        updated_at = p_now
    where execution_id = p_execution_id;
  else
    update public.ai_round_executions
    set updated_at = p_now
    where execution_id = p_execution_id;
  end if;

  update public.ai_round_active_leases
  set expires_at = v_lease_expires_at
  where execution_id = p_execution_id;

  update public.ai_round_usage_daily
  set model_calls_completed = model_calls_completed + case when p_status = 'completed' then 1 else 0 end,
      input_tokens_actual = input_tokens_actual + coalesce(p_input_tokens, 0),
      output_tokens_actual = output_tokens_actual + coalesce(p_output_tokens, 0),
      updated_at = p_now
  where usage_date = v_call.usage_date
    and (
      (scope_type = 'global' and scope_key = '*') or
      (scope_type = 'client' and scope_key = v_client_scope_key)
    );

  return jsonb_build_object(
    'status', 'recorded',
    'call_id', p_call_id,
    'duplicate', false,
    'lease_expires_at', v_lease_expires_at
  );
end;
$$;

create or replace function public.renew_ai_round_lease(
  p_execution_id uuid,
  p_lease_token uuid,
  p_lease_fence bigint,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_lease public.ai_round_active_leases%rowtype;
  v_lease_expires_at timestamptz;
begin
  if p_execution_id is null
    or p_lease_token is null
    or p_lease_fence is null
    or p_lease_fence <= 0 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into v_policy
  from public.ai_round_policy
  where singleton
  for update;

  select lease.* into v_lease
  from public.ai_round_active_leases as lease
  join public.ai_round_executions as execution
    on execution.execution_id = lease.execution_id
  where lease.execution_id = p_execution_id
    and execution.status = 'running'
  for update of lease;

  if v_lease.execution_id is null
    or v_lease.expires_at <= p_now
    or v_lease.lease_token <> p_lease_token
    or v_lease.lease_fence <> p_lease_fence then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  v_lease_expires_at := p_now + make_interval(secs => v_policy.lease_seconds);

  update public.ai_round_active_leases
  set expires_at = v_lease_expires_at
  where execution_id = p_execution_id;

  update public.ai_round_executions
  set updated_at = p_now
  where execution_id = p_execution_id;

  return jsonb_build_object(
    'status', 'renewed',
    'lease_expires_at', v_lease_expires_at
  );
end;
$$;

create or replace function public.complete_ai_round_request(
  p_execution_id uuid,
  p_lease_token uuid,
  p_lease_fence bigint,
  p_response jsonb,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_execution public.ai_round_executions%rowtype;
  v_lease public.ai_round_active_leases%rowtype;
  v_client_scope_key text;
  v_response_expires_at timestamptz;
begin
  if p_execution_id is null
    or p_lease_token is null
    or p_lease_fence is null
    or p_lease_fence <= 0
    or p_response is null
    or jsonb_typeof(p_response) <> 'object'
    or octet_length(p_response::text) > 8192 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into v_policy
  from public.ai_round_policy
  where singleton
  for update;

  select * into v_execution
  from public.ai_round_executions
  where execution_id = p_execution_id
  for update;

  if v_execution.execution_id is null then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  if v_execution.status = 'completed' then
    return jsonb_build_object(
      'status', 'completed',
      'execution_id', p_execution_id,
      'duplicate', true
    );
  end if;

  select * into v_lease
  from public.ai_round_active_leases
  where execution_id = p_execution_id
  for update;

  if v_execution.status <> 'running'
    or v_lease.execution_id is null
    or v_lease.expires_at <= p_now
    or v_execution.lease_token <> p_lease_token
    or v_execution.lease_fence <> p_lease_fence
    or v_lease.lease_token <> p_lease_token
    or v_lease.lease_fence <> p_lease_fence
    or v_execution.model_calls_reserved <> 1
    or v_execution.model_calls_completed <> 1 then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  v_client_scope_key := v_execution.attestation_class || ':' || v_execution.request_key_hash;
  v_response_expires_at := p_now + make_interval(secs => v_policy.result_ttl_seconds);

  update public.ai_round_executions
  set status = 'completed',
      response = p_response,
      response_expires_at = v_response_expires_at,
      error_code = null,
      error_expires_at = null,
      updated_at = p_now,
      completed_at = p_now,
      retain_until = greatest(
        retain_until,
        p_now + make_interval(days => v_policy.execution_retention_days)
      )
  where execution_id = p_execution_id;

  delete from public.ai_round_active_leases
  where execution_id = p_execution_id;

  update public.ai_round_usage_daily
  set completed_jobs = completed_jobs + 1,
      updated_at = p_now
  where usage_date = v_execution.usage_date
    and (
      (scope_type = 'global' and scope_key = '*') or
      (scope_type = 'client' and scope_key = v_client_scope_key)
    );

  return jsonb_build_object(
    'status', 'completed',
    'execution_id', p_execution_id,
    'duplicate', false,
    'response_expires_at', v_response_expires_at
  );
end;
$$;

create or replace function public.fail_ai_round_request(
  p_execution_id uuid,
  p_lease_token uuid,
  p_lease_fence bigint,
  p_error_code text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_execution public.ai_round_executions%rowtype;
  v_lease public.ai_round_active_leases%rowtype;
  v_client_scope_key text;
begin
  if p_execution_id is null
    or p_lease_token is null
    or p_lease_fence is null
    or p_lease_fence <= 0
    or p_error_code is null
    or char_length(p_error_code) not between 1 and 80
    or p_error_code !~ '^[a-z0-9_]+$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into v_policy
  from public.ai_round_policy
  where singleton
  for update;

  select * into v_execution
  from public.ai_round_executions
  where execution_id = p_execution_id
  for update;

  if v_execution.execution_id is null then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  if v_execution.status = 'failed' then
    return jsonb_build_object(
      'status', 'failed',
      'execution_id', p_execution_id,
      'duplicate', true,
      'error_code', v_execution.error_code
    );
  end if;

  select * into v_lease
  from public.ai_round_active_leases
  where execution_id = p_execution_id
  for update;

  if v_execution.status <> 'running'
    or v_lease.execution_id is null
    or v_lease.expires_at <= p_now
    or v_execution.lease_token <> p_lease_token
    or v_execution.lease_fence <> p_lease_fence
    or v_lease.lease_token <> p_lease_token
    or v_lease.lease_fence <> p_lease_fence then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  v_client_scope_key := v_execution.attestation_class || ':' || v_execution.request_key_hash;

  update public.ai_model_call_reservations
  set status = 'abandoned',
      finished_at = coalesce(finished_at, p_now)
  where execution_id = p_execution_id
    and status = 'reserved';

  update public.ai_round_executions
  set status = 'failed',
      error_code = p_error_code,
      response = null,
      response_expires_at = null,
      error_expires_at = p_now + make_interval(secs => v_policy.failed_ttl_seconds),
      updated_at = p_now,
      completed_at = p_now,
      retain_until = greatest(
        retain_until,
        p_now + make_interval(days => v_policy.execution_retention_days)
      )
  where execution_id = p_execution_id;

  delete from public.ai_round_active_leases
  where execution_id = p_execution_id;

  update public.ai_round_usage_daily
  set failed_jobs = failed_jobs + 1,
      updated_at = p_now
  where usage_date = v_execution.usage_date
    and (
      (scope_type = 'global' and scope_key = '*') or
      (scope_type = 'client' and scope_key = v_client_scope_key)
    );

  return jsonb_build_object(
    'status', 'failed',
    'execution_id', p_execution_id,
    'duplicate', false,
    'error_code', p_error_code
  );
end;
$$;

-- Boolean-compatible v1 RPC. It keeps the submitted Edge function operational
-- while applying the new kill switch and legacy request ceilings. The v2 Edge
-- handler must use begin_ai_round_request instead.
create or replace function public.consume_ai_round_quota(
  p_request_key_hash text,
  p_bucket_start timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ai_round_policy%rowtype;
  v_now timestamptz := clock_timestamp();
  v_usage_date date := private.ai_utc_date(v_now);
  v_hour_bucket timestamptz := date_trunc('hour', v_now at time zone 'UTC') at time zone 'UTC';
  v_client_scope_key text := 'legacy:' || p_request_key_hash;
  v_global public.ai_round_usage_daily%rowtype;
  v_client public.ai_round_usage_daily%rowtype;
  v_hourly_count integer;
  v_effective_hourly_limit integer;
begin
  if p_request_key_hash is null
    or p_request_key_hash !~ '^[0-9a-f]{64}$'
    or p_bucket_start is null
    or p_bucket_start <> v_hour_bucket
    or p_limit is null
    or p_limit <= 0 then
    return false;
  end if;

  select * into v_policy
  from public.ai_round_policy
  where singleton
  for update;

  perform private.ai_maybe_purge_round_control(v_now);

  if not v_policy.enabled
    or (v_policy.disabled_until is not null and v_policy.disabled_until > v_now)
    or (
      v_policy.attestation_mode = 'required'
      and (
        v_policy.attestation_enforcement_at is null
        or v_policy.attestation_enforcement_at <= v_now
      )
    ) then
    return false;
  end if;

  perform private.ai_ensure_usage_rows(v_usage_date, p_request_key_hash, 'legacy', v_now);

  select * into v_global
  from public.ai_round_usage_daily
  where usage_date = v_usage_date and scope_type = 'global' and scope_key = '*'
  for update;

  select * into v_client
  from public.ai_round_usage_daily
  where usage_date = v_usage_date
    and scope_type = 'client'
    and scope_key = v_client_scope_key
  for update;

  if v_global.request_attempts >= v_policy.global_daily_requests
    or v_client.request_attempts >= v_policy.legacy_daily_requests_per_key then
    return false;
  end if;

  insert into public.ai_round_request_limits (
    request_key_hash,
    bucket_start,
    request_count,
    updated_at
  ) values (
    p_request_key_hash,
    v_hour_bucket,
    0,
    v_now
  )
  on conflict (request_key_hash, bucket_start) do nothing;

  select request_count into v_hourly_count
  from public.ai_round_request_limits
  where request_key_hash = p_request_key_hash
    and bucket_start = v_hour_bucket
  for update;

  v_effective_hourly_limit := least(p_limit, v_policy.legacy_hourly_requests_per_key);

  if v_hourly_count >= v_effective_hourly_limit then
    return false;
  end if;

  update public.ai_round_request_limits
  set request_count = request_count + 1,
      updated_at = v_now
  where request_key_hash = p_request_key_hash
    and bucket_start = v_hour_bucket;

  update public.ai_round_usage_daily
  set request_attempts = request_attempts + 1,
      accepted_jobs = accepted_jobs + 1,
      updated_at = v_now
  where usage_date = v_usage_date
    and (
      (scope_type = 'global' and scope_key = '*') or
      (scope_type = 'client' and scope_key = v_client_scope_key)
    );

  return true;
end;
$$;

create or replace function public.purge_ai_round_control(
  p_batch_size integer default 5000,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_batch_size is null or p_batch_size not between 1 and 50000 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('ai_round_retention_purge', 0)
  ) then
    return jsonb_build_object('status', 'skipped', 'reason', 'already_running');
  end if;

  v_result := private.ai_purge_round_control_internal(p_now, p_batch_size);

  update public.ai_round_policy
  set last_purge_at = p_now,
      updated_at = p_now
  where singleton;

  return v_result;
end;
$$;

-- RPC access is deliberately service-role-only because the Edge Function has
-- verify_jwt=false. No quota, attestation, or execution table is directly
-- exposed to anon/authenticated callers.
revoke execute on all functions in schema private from public, anon, authenticated;

revoke all on function public.issue_ai_app_attest_challenge(
  text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.register_ai_app_attest_key(
  text, text, text, text, text, text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.revoke_ai_app_attest_key(
  text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.begin_ai_round_request(
  text, text, text, text, text, uuid, text, bigint, bigint, timestamptz
) from public, anon, authenticated;
revoke all on function public.reserve_ai_model_call(
  uuid, uuid, bigint, text, integer, text, bigint, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.record_ai_model_call(
  uuid, uuid, uuid, bigint, text, integer, integer, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.renew_ai_round_lease(
  uuid, uuid, bigint, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_ai_round_request(
  uuid, uuid, bigint, jsonb, timestamptz
) from public, anon, authenticated;
revoke all on function public.fail_ai_round_request(
  uuid, uuid, bigint, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.consume_ai_round_quota(
  text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.purge_ai_round_control(
  integer, timestamptz
) from public, anon, authenticated;

grant execute on function public.issue_ai_app_attest_challenge(
  text, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.register_ai_app_attest_key(
  text, text, text, text, text, text, uuid, text, text, text, timestamptz
) to service_role;
grant execute on function public.revoke_ai_app_attest_key(
  text, text, timestamptz
) to service_role;
grant execute on function public.begin_ai_round_request(
  text, text, text, text, text, uuid, text, bigint, bigint, timestamptz
) to service_role;
grant execute on function public.reserve_ai_model_call(
  uuid, uuid, bigint, text, integer, text, bigint, integer, timestamptz
) to service_role;
grant execute on function public.record_ai_model_call(
  uuid, uuid, uuid, bigint, text, integer, integer, text, timestamptz
) to service_role;
grant execute on function public.renew_ai_round_lease(
  uuid, uuid, bigint, timestamptz
) to service_role;
grant execute on function public.complete_ai_round_request(
  uuid, uuid, bigint, jsonb, timestamptz
) to service_role;
grant execute on function public.fail_ai_round_request(
  uuid, uuid, bigint, text, timestamptz
) to service_role;
grant execute on function public.consume_ai_round_quota(
  text, timestamptz, integer
) to service_role;
grant execute on function public.purge_ai_round_control(
  integer, timestamptz
) to service_role;

revoke all on table public.ai_round_policy from service_role;
revoke all on table public.ai_round_usage_daily from service_role;
revoke all on table public.app_attest_keys from service_role;
revoke all on table public.app_attest_challenges from service_role;
revoke all on table public.ai_round_executions from service_role;
revoke all on table public.ai_round_active_leases from service_role;
revoke all on table public.ai_model_call_reservations from service_role;
revoke all on table public.ai_round_request_limits from service_role;

-- The Edge verifier needs the stored public key/counter before it can validate
-- an assertion. All writes remain confined to SECURITY DEFINER RPCs.
grant select on table public.app_attest_keys to service_role;

-- Prefer pg_cron when the project permits it. Any extension or scheduling
-- failure is non-fatal because issue/begin/legacy admission also run the
-- advisory-locked, five-minute bounded cleanup fallback.
do $migration$
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice 'pg_cron unavailable; opportunistic cleanup remains active: %', sqlerrm;
  end;

  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $schedule$
        select cron.unschedule(jobid)
        from cron.job
        where jobname = 'purge-ai-round-control'
      $schedule$;
      execute $schedule$
        select cron.schedule(
          'purge-ai-round-control',
          '17 * * * *',
          'select public.purge_ai_round_control(50000)'
        )
      $schedule$;
    exception when others then
      raise notice 'pg_cron scheduling failed; opportunistic cleanup remains active: %', sqlerrm;
    end;
  else
    raise notice 'pg_cron not installed; opportunistic cleanup remains active';
  end if;
end;
$migration$;
