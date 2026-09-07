begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select no_plan();

create temporary table hardening_test_results (
  name text primary key,
  result jsonb not null
) on commit drop;

create temporary table legacy_quota_results (
  call_number integer primary key,
  allowed boolean not null
) on commit drop;

-- Schema, seeded policy, RLS, least privilege, and stable RPC signatures.
select has_table('public', 'ai_round_policy', 'runtime policy table exists');
select has_table('public', 'ai_round_usage_daily', 'daily usage table exists');
select has_table('public', 'ai_round_executions', 'execution tombstone table exists');
select has_table('public', 'ai_round_active_leases', 'active lease table exists');
select has_table('public', 'ai_model_call_reservations', 'model reservation table exists');
select has_table('public', 'app_attest_keys', 'App Attest key table exists');
select has_table('public', 'app_attest_challenges', 'App Attest challenge table exists');
select has_table('public', 'ai_round_request_limits', 'legacy hourly table is retained');

update public.ai_round_policy
set enabled = true,
    disabled_until = null,
    attestation_mode = 'observe',
    attested_hourly_requests_per_key = 30,
    attested_daily_requests_per_key = 120,
    attested_daily_model_calls_per_key = 120,
    attested_concurrency_per_key = 1,
    legacy_hourly_requests_per_key = 10,
    legacy_daily_requests_per_key = 30,
    legacy_daily_model_calls_per_key = 30,
    legacy_concurrency_per_key = 2,
    global_daily_requests = 2000,
    global_daily_model_calls = 2000,
    daily_cost_microusd_per_key = 25000000,
    global_daily_cost_microusd = 25000000,
    global_concurrency = 8,
    lease_seconds = 20,
    challenge_hourly_per_key = 20,
    challenge_hourly_global = 2000,
    model_call_retention_days = 7,
    execution_retention_days = 7,
    last_purge_at = '2031-01-01 00:00:00+00';

select is((select attestation_mode from public.ai_round_policy), 'observe', 'observe mode is seeded');
select is((select attested_hourly_requests_per_key from public.ai_round_policy), 30, 'attested hourly default is 30');
select is((select attested_daily_requests_per_key from public.ai_round_policy), 120, 'attested daily default is 120');
select is((select attested_daily_model_calls_per_key from public.ai_round_policy), 120, 'attested model-call default matches request quota');
select is((select attested_concurrency_per_key from public.ai_round_policy), 1, 'attested concurrency default is 1');
select is((select legacy_hourly_requests_per_key from public.ai_round_policy), 10, 'legacy hourly default is 10');
select is((select legacy_daily_requests_per_key from public.ai_round_policy), 30, 'legacy daily default is 30');
select is((select legacy_daily_model_calls_per_key from public.ai_round_policy), 30, 'legacy model-call default matches request quota');
select is((select legacy_concurrency_per_key from public.ai_round_policy), 2, 'legacy concurrency default is 2');
select is((select global_daily_requests from public.ai_round_policy), 2000, 'global daily request default is 2,000');
select is((select global_daily_model_calls from public.ai_round_policy), 2000, 'global daily model-call default is 2,000');
select is((select global_concurrency from public.ai_round_policy), 8, 'global concurrency default is 8');
select is((select lease_seconds from public.ai_round_policy), 20, 'lease default is 20 seconds');
select is((select legacy_provider_cooldown_seconds from public.ai_round_policy), 30, 'legacy provider/delivery cooldown default is 30 seconds');
select is((select challenge_hourly_per_key from public.ai_round_policy), 20, 'registration challenge fingerprint cap is 20/hour');
select is((select global_daily_cost_microusd from public.ai_round_policy), 25000000::bigint, 'global daily cost cap is $25 in micro-USD');
select is((select daily_cost_microusd_per_key from public.ai_round_policy), 25000000::bigint, 'per-principal cost cap does not undercut request quotas');
select is((select model_call_retention_days from public.ai_round_policy), 7, 'model reservations retain for seven days');
select is((select app_attest_signed_path from public.ai_round_policy), '/functions/v1/generate-round', 'signed path is fixed');

select ok(
  (select bool_and(relrowsecurity)
   from pg_class
   where oid in (
     'public.ai_round_policy'::regclass,
     'public.ai_round_usage_daily'::regclass,
     'public.ai_round_executions'::regclass,
     'public.ai_round_active_leases'::regclass,
     'public.ai_model_call_reservations'::regclass,
     'public.app_attest_keys'::regclass,
     'public.app_attest_challenges'::regclass,
     'public.ai_round_request_limits'::regclass
   )),
  'all state tables have RLS enabled'
);

select ok(has_table_privilege('service_role', 'public.app_attest_keys', 'SELECT'), 'service role can read stored verification keys');
select ok(not has_table_privilege('service_role', 'public.app_attest_keys', 'UPDATE'), 'service role cannot directly update verification keys');
select ok(not has_table_privilege('service_role', 'public.ai_round_policy', 'SELECT'), 'service role has no direct policy-table access');
select ok(not has_table_privilege('anon', 'public.app_attest_keys', 'SELECT'), 'anonymous callers cannot read verification keys');

select ok(to_regprocedure('public.issue_ai_app_attest_challenge(text,text,text,text,text,timestamp with time zone)') is not null, 'challenge RPC signature is stable');
select ok(to_regprocedure('public.register_ai_app_attest_key(text,text,text,text,text,text,uuid,text,text,text,timestamp with time zone)') is not null, 'registration RPC signature includes requestId');
select ok(to_regprocedure('public.begin_ai_round_request(text,text,text,text,text,uuid,text,bigint,bigint,timestamp with time zone)') is not null, 'admission RPC signature is stable');
select ok(to_regprocedure('public.reserve_ai_model_call(uuid,uuid,bigint,text,integer,text,bigint,integer,timestamp with time zone)') is not null, 'reservation RPC signature is stable');
select ok(to_regprocedure('public.record_ai_model_call(uuid,uuid,uuid,bigint,text,integer,integer,text,timestamp with time zone)') is not null, 'model result RPC signature is stable');
select ok(to_regprocedure('public.renew_ai_round_lease(uuid,uuid,bigint,timestamp with time zone)') is not null, 'lease renewal RPC signature is stable');
select ok(to_regprocedure('public.complete_ai_round_request(uuid,uuid,bigint,jsonb,timestamp with time zone)') is not null, 'completion RPC signature is stable');
select ok(to_regprocedure('public.fail_ai_round_request(uuid,uuid,bigint,text,timestamp with time zone)') is not null, 'failure RPC signature is stable');
select ok(to_regprocedure('public.purge_ai_round_control(integer,timestamp with time zone)') is not null, 'purge RPC signature is stable');
select ok(
  has_function_privilege(
    'service_role',
    'public.begin_ai_round_request(text,text,text,text,text,uuid,text,bigint,bigint,timestamp with time zone)',
    'EXECUTE'
  ),
  'service role can call admission RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.begin_ai_round_request(text,text,text,text,text,uuid,text,bigint,bigint,timestamp with time zone)',
    'EXECUTE'
  ),
  'anonymous callers cannot call admission RPC'
);

select ok(
  position('interval ''5 minutes''' in pg_get_functiondef('private.ai_maybe_purge_round_control(timestamp with time zone)'::regprocedure)) > 0,
  'opportunistic cleanup can run every five minutes'
);
select ok(
  position('5000' in pg_get_functiondef('private.ai_maybe_purge_round_control(timestamp with time zone)'::regprocedure)) > 0,
  'each opportunistic cleanup can purge 5,000 rows per retained table'
);
select ok(5000 * 288 > 2000 * 24, 'fallback daily challenge cleanup capacity exceeds the admitted maximum');

create temporary table cron_hardening_assertion (configured boolean not null) on commit drop;
do $test$
declare
  v_configured boolean;
begin
  if to_regclass('cron.job') is null then
    v_configured := true;
  else
    execute $query$
      select exists (
        select 1
        from cron.job
        where jobname = 'purge-ai-round-control'
          and schedule = '17 * * * *'
          and command like '%purge_ai_round_control(50000)%'
      )
    $query$ into v_configured;
  end if;

  insert into cron_hardening_assertion values (v_configured);
end;
$test$;
select ok((select configured from cron_hardening_assertion), 'pg_cron is either unavailable or has the hourly 50,000-row purge job');

-- Registration challenge issuance is idempotent and charges the salted legacy
-- principal once, even when the caller rotates an untrusted proposed key ID.
truncate table
  public.app_attest_challenges,
  public.ai_model_call_reservations,
  public.ai_round_active_leases,
  public.ai_round_executions,
  public.app_attest_keys,
  public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;

insert into hardening_test_results (name, result)
values (
  'attest_issue',
  public.issue_ai_app_attest_challenge(
    'attest', repeat('a', 64), repeat('b', 64), null,
    '00000000-0000-4000-8000-000000000001', '2030-01-01 00:00:00+00'
  )
);

insert into hardening_test_results (name, result)
values (
  'attest_issue_replay',
  public.issue_ai_app_attest_challenge(
    'attest', repeat('a', 64), repeat('b', 64), null,
    '00000000-0000-4000-8000-000000000001', '2030-01-01 00:00:01+00'
  )
);

insert into hardening_test_results (name, result)
values (
  'attest_issue_network_replay',
  public.issue_ai_app_attest_challenge(
    'attest', repeat('f', 64), repeat('b', 64), null,
    '00000000-0000-4000-8000-000000000001', '2030-01-01 00:00:02+00'
  )
);

select is((select result->>'status' from hardening_test_results where name = 'attest_issue'), 'issued', 'first challenge is issued');
select is((select (result->>'duplicate')::boolean from hardening_test_results where name = 'attest_issue'), false, 'first challenge is not a duplicate');
select is((select char_length(result->>'challenge') from hardening_test_results where name = 'attest_issue'), 43, 'challenge is 43-character base64url');
select is(
  (select result->>'challenge' from hardening_test_results where name = 'attest_issue_replay'),
  (select result->>'challenge' from hardening_test_results where name = 'attest_issue'),
  'lost issuance response replay returns the same random challenge'
);
select is((select (result->>'duplicate')::boolean from hardening_test_results where name = 'attest_issue_replay'), true, 'issuance replay is marked duplicate');
select is(
  (select result->>'challenge' from hardening_test_results where name = 'attest_issue_network_replay'),
  (select result->>'challenge' from hardening_test_results where name = 'attest_issue'),
  'enrollment issuance replay survives a network-principal change'
);
select is((select (result->>'duplicate')::boolean from hardening_test_results where name = 'attest_issue_network_replay'), true, 'network-change issuance replay is marked duplicate');
select is((select count(*) from public.app_attest_challenges), 1::bigint, 'issuance replay creates no orphan challenge');
select is(
  (select challenge_issues from public.ai_round_usage_daily where scope_type = 'global' and scope_key = '*'),
  1::bigint,
  'issuance replay consumes global challenge quota once'
);
select is(
  (select challenge_issues from public.ai_round_usage_daily where scope_type = 'client' and scope_key = 'legacy:' || repeat('a', 64)),
  1::bigint,
  'issuance replay consumes legacy-principal challenge quota once'
);
select is(
  (select count(*) from public.ai_round_usage_daily where scope_type = 'client' and scope_key = 'legacy:' || repeat('f', 64)),
  0::bigint,
  'network replay does not move or duplicate original quota attribution'
);

insert into hardening_test_results (name, result)
values (
  'attest_issue_conflict',
  public.issue_ai_app_attest_challenge(
    'attest', repeat('a', 64), repeat('c', 64), null,
    '00000000-0000-4000-8000-000000000001', '2030-01-01 00:00:02+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'attest_issue_conflict'), 'conflict', 'requestId reuse with a different challenge binding conflicts');

-- Network changes after issue do not invalidate a valid registration. An
-- exact retry after the first registration consumed the challenge succeeds.
insert into hardening_test_results (name, result)
select
  'register_first',
  public.register_ai_app_attest_key(
    repeat('b', 64), repeat('P', 64), repeat('R', 64),
    'com.example.imposter', 'TEAM123456', 'production',
    (result->>'challenge_id')::uuid, result->>'challenge', repeat('c', 64),
    '00000000-0000-4000-8000-000000000001', '2030-01-01 00:00:03+00'
  )
from hardening_test_results
where name = 'attest_issue';

insert into hardening_test_results (name, result)
select
  'register_replay',
  public.register_ai_app_attest_key(
    repeat('b', 64), repeat('P', 64), repeat('R', 64),
    'com.example.imposter', 'TEAM123456', 'production',
    (result->>'challenge_id')::uuid, result->>'challenge', repeat('d', 64),
    '00000000-0000-4000-8000-000000000001', '2030-01-01 00:00:04+00'
  )
from hardening_test_results
where name = 'attest_issue';

select is((select result->>'status' from hardening_test_results where name = 'register_first'), 'registered', 'registration succeeds after a network-principal change');
select is((select (result->>'duplicate')::boolean from hardening_test_results where name = 'register_first'), false, 'first registration is not duplicate');
select is((select result->>'status' from hardening_test_results where name = 'register_replay'), 'registered', 'lost registration response replay succeeds');
select is((select (result->>'duplicate')::boolean from hardening_test_results where name = 'register_replay'), true, 'lost registration response replay is marked duplicate');
select is((select assertion_counter from public.app_attest_keys where key_id_hash = repeat('b', 64)), 0::bigint, 'registration replay does not advance assertion counter');

insert into hardening_test_results (name, result)
select
  'register_mismatch',
  public.register_ai_app_attest_key(
    repeat('b', 64), repeat('P', 64), repeat('X', 64),
    'com.example.imposter', 'TEAM123456', 'production',
    (result->>'challenge_id')::uuid, result->>'challenge', repeat('d', 64),
    '00000000-0000-4000-8000-000000000001', '2030-01-01 00:00:05+00'
  )
from hardening_test_results
where name = 'attest_issue';
select is((select result->>'status' from hardening_test_results where name = 'register_mismatch'), 'attestation_invalid', 'used registration challenge cannot replay with changed bytes');

-- Assertion challenge payload binding, stable App Attest principal, atomic
-- concurrency, one provider reservation, and completed-response idempotency.
insert into hardening_test_results (name, result)
values (
  'assert_one_issue',
  public.issue_ai_app_attest_challenge(
    'assert', repeat('c', 64), repeat('b', 64), repeat('1', 64),
    '00000000-0000-4000-8000-000000000002', '2030-01-01 00:01:00+00'
  )
);

insert into hardening_test_results (name, result)
values (
  'assert_one_payload_conflict',
  public.issue_ai_app_attest_challenge(
    'assert', repeat('c', 64), repeat('b', 64), repeat('2', 64),
    '00000000-0000-4000-8000-000000000002', '2030-01-01 00:01:01+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'assert_one_payload_conflict'), 'conflict', 'assertion challenge replay with a different payload conflicts');

insert into hardening_test_results (name, result)
select
  'begin_attested_one',
  public.begin_ai_round_request(
    repeat('d', 64), '00000000-0000-4000-8000-000000000002', repeat('1', 64),
    'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
    result->>'challenge', 0, 1, '2030-01-01 00:01:02+00'
  )
from hardening_test_results
where name = 'assert_one_issue';

select is((select result->>'status' from hardening_test_results where name = 'begin_attested_one'), 'accepted', 'valid assertion is admitted');
select is((select result->>'attestation_class' from hardening_test_results where name = 'begin_attested_one'), 'attested', 'valid assertion receives attested policy');
select is((select request_key_hash from public.ai_round_executions where idempotency_key = '00000000-0000-4000-8000-000000000002'), repeat('b', 64), 'execution stores stable App Attest principal');
select is((select assertion_counter from public.app_attest_keys where key_id_hash = repeat('b', 64)), 1::bigint, 'accepted assertion advances counter once');
select is(
  (select request_attempts from public.ai_round_usage_daily where scope_type = 'client' and scope_key = 'attested:' || repeat('b', 64)),
  1::bigint,
  'attested usage is charged to App Attest key'
);

insert into hardening_test_results (name, result)
values (
  'assert_two_issue',
  public.issue_ai_app_attest_challenge(
    'assert', repeat('e', 64), repeat('b', 64), repeat('2', 64),
    '00000000-0000-4000-8000-000000000003', '2030-01-01 00:01:03+00'
  )
);

insert into hardening_test_results (name, result)
select
  'begin_attested_two_limited',
  public.begin_ai_round_request(
    repeat('f', 64), '00000000-0000-4000-8000-000000000003', repeat('2', 64),
    'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
    result->>'challenge', 0, 2, '2030-01-01 00:01:04+00'
  )
from hardening_test_results
where name = 'assert_two_issue';

select is((select result->>'status' from hardening_test_results where name = 'begin_attested_two_limited'), 'concurrency_limited', 'same App Attest key is concurrency-limited across changed fingerprints');
select is((select assertion_counter from public.app_attest_keys where key_id_hash = repeat('b', 64)), 1::bigint, 'stale-read assertion validates but concurrency rejection does not consume it');
select ok((select used_at is null from public.app_attest_challenges where idempotency_key = '00000000-0000-4000-8000-000000000003'), 'concurrency rejection leaves challenge reusable');

insert into hardening_test_results (name, result)
select
  'reserve_attempt_zero',
  public.reserve_ai_model_call(
    (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
    (result->>'lease_fence')::bigint, 'generation', 0, 'gpt-5.4-mini',
    1000, 160, '2030-01-01 00:01:05+00'
  )
from hardening_test_results
where name = 'begin_attested_one';
select is((select result->>'status' from hardening_test_results where name = 'reserve_attempt_zero'), 'invalid_request', 'only provider attempt 1 is accepted');

insert into hardening_test_results (name, result)
select
  'reserve_one',
  public.reserve_ai_model_call(
    (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
    (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
    1000, 160, '2030-01-01 00:01:06+00'
  )
from hardening_test_results
where name = 'begin_attested_one';

insert into hardening_test_results (name, result)
select
  'reserve_one_replay',
  public.reserve_ai_model_call(
    (begin_result.result->>'execution_id')::uuid,
    (begin_result.result->>'lease_token')::uuid,
    (begin_result.result->>'lease_fence')::bigint,
    'generation', 1, 'gpt-5.4-mini', 1000, 160,
    '2030-01-01 00:01:07+00'
  )
from hardening_test_results as begin_result
where begin_result.name = 'begin_attested_one';

select is((select result->>'status' from hardening_test_results where name = 'reserve_one'), 'reserved', 'first provider call is reserved');
select is((select result->>'status' from hardening_test_results where name = 'reserve_one_replay'), 'already_reserved', 'duplicate reservation is fail-closed');
select is((select count(*) from public.ai_model_call_reservations), 1::bigint, 'duplicate reservation creates no second provider permission');
select is((select model_calls_reserved from public.ai_round_executions where idempotency_key = '00000000-0000-4000-8000-000000000002'), 1, 'execution records exactly one reservation');
select is(
  (select model_calls_reserved from public.ai_round_usage_daily where scope_type = 'client' and scope_key = 'attested:' || repeat('b', 64)),
  1::bigint,
  'duplicate reservation consumes model quota once'
);

insert into hardening_test_results (name, result)
select
  'record_one',
  public.record_ai_model_call(
    (reserve_result.result->>'call_id')::uuid,
    (begin_result.result->>'execution_id')::uuid,
    (begin_result.result->>'lease_token')::uuid,
    (begin_result.result->>'lease_fence')::bigint,
    'completed', 100, 20, repeat('9', 64), '2030-01-01 00:01:08+00'
  )
from hardening_test_results as reserve_result
cross join hardening_test_results as begin_result
where reserve_result.name = 'reserve_one'
  and begin_result.name = 'begin_attested_one';
select is((select result->>'status' from hardening_test_results where name = 'record_one'), 'recorded', 'provider result is recorded');

insert into hardening_test_results (name, result)
select
  'complete_one',
  public.complete_ai_round_request(
    (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
    (result->>'lease_fence')::bigint, '{"word":"apple","clue":"fruit"}'::jsonb,
    '2030-01-01 00:01:09+00'
  )
from hardening_test_results
where name = 'begin_attested_one';
select is((select result->>'status' from hardening_test_results where name = 'complete_one'), 'completed', 'one-reservation execution completes');

insert into hardening_test_results (name, result)
select
  'begin_attested_two_retry',
  public.begin_ai_round_request(
    repeat('0', 64), '00000000-0000-4000-8000-000000000003', repeat('2', 64),
    'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
    result->>'challenge', 0, 2, '2030-01-01 00:01:10+00'
  )
from hardening_test_results
where name = 'assert_two_issue';
select is((select result->>'status' from hardening_test_results where name = 'begin_attested_two_retry'), 'accepted', 'higher signed counter succeeds despite stale Edge previous-counter read');
select is((select assertion_counter from public.app_attest_keys where key_id_hash = repeat('b', 64)), 2::bigint, 'stale-read retry atomically advances to signed counter exactly once');
select is((select count(*) from public.ai_round_usage_daily where scope_key in ('attested:' || repeat('e', 64), 'attested:' || repeat('f', 64), 'attested:' || repeat('0', 64))), 0::bigint, 'changed network fingerprints do not create attested quota scopes');

insert into hardening_test_results (name, result)
values (
  'completed_cross_principal_replay',
  public.begin_ai_round_request(
    repeat('7', 64), '00000000-0000-4000-8000-000000000002', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-01-01 00:01:11+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'completed_cross_principal_replay'), 'completed', 'global request UUID replays completed result across a principal change');
select is((select result->'response'->>'word' from hardening_test_results where name = 'completed_cross_principal_replay'), 'apple', 'completed replay returns cached response');

insert into hardening_test_results (name, result)
values (
  'completed_payload_conflict',
  public.begin_ai_round_request(
    repeat('7', 64), '00000000-0000-4000-8000-000000000002', repeat('8', 64),
    'generate-round', null, null, null, null, null, '2030-01-01 00:01:12+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'completed_payload_conflict'), 'conflict', 'global request UUID cannot be reused for another payload');

-- Observe mode downgrades invalid proof without consuming it; required mode
-- rejects missing and malformed proof before request quotas are incremented.
insert into hardening_test_results (name, result)
values (
  'observe_equal_issue',
  public.issue_ai_app_attest_challenge(
    'assert', repeat('6', 64), repeat('b', 64), repeat('4', 64),
    '00000000-0000-4000-8000-000000000004', '2030-01-01 00:01:12+00'
  )
);
insert into hardening_test_results (name, result)
select
  'observe_invalid_downgrade',
  public.begin_ai_round_request(
    repeat('6', 64), '00000000-0000-4000-8000-000000000004', repeat('4', 64),
    'translate-word', repeat('b', 64), (result->>'challenge_id')::uuid,
    result->>'challenge', 1, 2, '2030-01-01 00:01:13+00'
  )
from hardening_test_results
where name = 'observe_equal_issue';
select is((select result->>'status' from hardening_test_results where name = 'observe_invalid_downgrade'), 'accepted', 'observe mode admits invalid proof under legacy controls');
select is((select result->>'attestation_class' from hardening_test_results where name = 'observe_invalid_downgrade'), 'legacy', 'observe invalid proof is explicitly downgraded');
select is((select result->>'attestation_status' from hardening_test_results where name = 'observe_invalid_downgrade'), 'invalid', 'observe downgrade explicitly reports invalid integrity');
select is((select assertion_counter from public.app_attest_keys where key_id_hash = repeat('b', 64)), 2::bigint, 'equal signed counter replay does not advance counter');
select ok((select used_at is null from public.app_attest_challenges where idempotency_key = '00000000-0000-4000-8000-000000000004'), 'equal signed counter does not consume its challenge');

insert into hardening_test_results (name, result)
values (
  'off_assert_issue',
  public.issue_ai_app_attest_challenge(
    'assert', repeat('3', 64), repeat('b', 64), repeat('8', 64),
    '00000000-0000-4000-8000-000000000008', '2030-01-01 00:01:14+00'
  )
);

update public.ai_round_policy set attestation_mode = 'off';
insert into hardening_test_results (name, result)
select
  'off_valid_tuple',
  public.begin_ai_round_request(
    repeat('2', 64), '00000000-0000-4000-8000-000000000008', repeat('8', 64),
    'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
    result->>'challenge', 2, 3, '2030-01-01 00:01:15+00'
  )
from hardening_test_results
where name = 'off_assert_issue';
select is((select result->>'status' from hardening_test_results where name = 'off_valid_tuple'), 'accepted', 'off mode intentionally ignores a supplied valid tuple');
select is((select result->>'attestation_class' from hardening_test_results where name = 'off_valid_tuple'), 'legacy', 'off mode applies legacy controls');
select is((select result->>'attestation_status' from hardening_test_results where name = 'off_valid_tuple'), 'off', 'off mode is distinct from invalid integrity');
select is((select assertion_counter from public.app_attest_keys where key_id_hash = repeat('b', 64)), 2::bigint, 'off mode does not consume assertion counter');
select ok((select used_at is null from public.app_attest_challenges where idempotency_key = '00000000-0000-4000-8000-000000000008'), 'off mode does not consume assertion challenge');

update public.ai_round_policy
set attestation_mode = 'required',
    attestation_enforcement_at = null;

insert into hardening_test_results (name, result)
values (
  'required_missing',
  public.begin_ai_round_request(
    repeat('5', 64), '00000000-0000-4000-8000-000000000005', repeat('5', 64),
    'generate-round', null, null, null, null, null, '2030-01-01 00:01:16+00'
  )
),
(
  'required_invalid',
  public.begin_ai_round_request(
    repeat('5', 64), '00000000-0000-4000-8000-000000000006', repeat('6', 64),
    'generate-round', repeat('b', 64), '10000000-0000-4000-8000-000000000006'::uuid,
    repeat('Z', 43), 2, 3, '2030-01-01 00:01:17+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'required_missing'), 'attestation_required', 'required mode rejects missing proof');
select is((select result->>'status' from hardening_test_results where name = 'required_invalid'), 'attestation_invalid', 'required mode rejects invalid proof');

update public.ai_round_policy set enabled = false;
insert into hardening_test_results (name, result)
values (
  'kill_switch',
  public.begin_ai_round_request(
    repeat('4', 64), '00000000-0000-4000-8000-000000000007', repeat('7', 64),
    'generate-round', null, null, null, null, null, '2030-01-01 00:01:18+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'kill_switch'), 'disabled', 'kill switch disables admission');

-- A failed paid request remains a seven-day idempotency tombstone with its one
-- provider reservation after the 15-minute safe error replay window expires.
truncate table
  public.app_attest_challenges,
  public.ai_model_call_reservations,
  public.ai_round_active_leases,
  public.ai_round_executions,
  public.app_attest_keys,
  public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set enabled = true,
    disabled_until = null,
    attestation_mode = 'observe',
    attestation_enforcement_at = null,
    legacy_concurrency_per_key = 2,
    last_purge_at = '2031-01-01 00:00:00+00';

insert into hardening_test_results (name, result)
values (
  'failed_begin',
  public.begin_ai_round_request(
    repeat('a', 64), '00000000-0000-4000-8000-000000000010', repeat('a', 64),
    'generate-round', null, null, null, null, null, '2030-02-01 00:00:00+00'
  )
);

insert into hardening_test_results (name, result)
select
  'failed_begin_network_replay',
  public.begin_ai_round_request(
    repeat('b', 64), '00000000-0000-4000-8000-000000000010', repeat('a', 64),
    'generate-round', null, null, null, null, null, '2030-02-01 00:00:01+00'
  )
from hardening_test_results
where name = 'failed_begin';
select is((select result->>'status' from hardening_test_results where name = 'failed_begin_network_replay'), 'in_progress', 'legacy transport retry survives a changed principal');
select is((select count(*) from public.ai_round_executions), 1::bigint, 'changed-principal retry creates one execution');
select is((select request_attempts from public.ai_round_usage_daily where scope_type = 'global' and scope_key = '*'), 1::bigint, 'changed-principal retry consumes request quota once');

insert into hardening_test_results (name, result)
select
  'failed_reserve',
  public.reserve_ai_model_call(
    (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
    (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4',
    2000, 256, '2030-02-01 00:00:05+00'
  )
from hardening_test_results
where name = 'failed_begin';

insert into hardening_test_results (name, result)
select
  'failed_record',
  public.record_ai_model_call(
    (reserve_result.result->>'call_id')::uuid,
    (begin_result.result->>'execution_id')::uuid,
    (begin_result.result->>'lease_token')::uuid,
    (begin_result.result->>'lease_fence')::bigint,
    'failed', null, null, null, '2030-02-01 00:00:10+00'
  )
from hardening_test_results as reserve_result
cross join hardening_test_results as begin_result
where reserve_result.name = 'failed_reserve'
  and begin_result.name = 'failed_begin';

insert into hardening_test_results (name, result)
select
  'failed_finish',
  public.fail_ai_round_request(
    (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
    (result->>'lease_fence')::bigint, 'provider_failed', '2030-02-01 00:00:15+00'
  )
from hardening_test_results
where name = 'failed_begin';
select is((select result->>'status' from hardening_test_results where name = 'failed_finish'), 'failed', 'failed provider execution is tombstoned');

insert into hardening_test_results (name, result)
values (
  'failed_after_error_ttl',
  public.begin_ai_round_request(
    repeat('c', 64), '00000000-0000-4000-8000-000000000010', repeat('a', 64),
    'generate-round', null, null, null, null, null, '2030-02-01 00:16:00+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'failed_after_error_ttl'), 'idempotency_expired', 'same UUID cannot restart after 15-minute error cache expires');

insert into hardening_test_results (name, result)
values (
  'purge_before_retention',
  public.purge_ai_round_control(50000, '2030-02-01 00:16:01+00')
);
select is((select count(*) from public.ai_round_executions where idempotency_key = '00000000-0000-4000-8000-000000000010'), 1::bigint, 'failed execution tombstone survives early purge');
select is((select count(*) from public.ai_model_call_reservations), 1::bigint, 'provider reservation survives with its tombstone');

insert into hardening_test_results (name, result)
values (
  'failed_after_early_purge',
  public.begin_ai_round_request(
    repeat('d', 64), '00000000-0000-4000-8000-000000000010', repeat('a', 64),
    'generate-round', null, null, null, null, null, '2030-02-07 23:59:59+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'failed_after_early_purge'), 'idempotency_expired', 'failed UUID remains blocked for the full seven-day window');
select is((select count(*) from public.ai_model_call_reservations), 1::bigint, 'seven-day window retains exactly one provider attempt record');

-- A legacy paid failure cools only that salted fingerprint. A verified App
-- Attest key is not penalized, and a later legacy request resumes after 30s.
truncate table
  public.app_attest_challenges,
  public.ai_model_call_reservations,
  public.ai_round_active_leases,
  public.ai_round_executions,
  public.app_attest_keys,
  public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set enabled = true,
    attestation_mode = 'observe',
    legacy_provider_cooldown_seconds = 30,
    last_purge_at = '2031-01-01 00:00:00+00';

insert into hardening_test_results (name, result)
values (
  'cooldown_begin',
  public.begin_ai_round_request(
    repeat('a', 64), '30000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-02-10 00:00:00+00'
  )
);
insert into hardening_test_results (name, result)
select
  'cooldown_reserve',
  public.reserve_ai_model_call(
    (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
    (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
    1000, 160, '2030-02-10 00:00:01+00'
  )
from hardening_test_results where name = 'cooldown_begin';
insert into hardening_test_results (name, result)
select
  'cooldown_fail',
  public.fail_ai_round_request(
    (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
    (result->>'lease_fence')::bigint, 'provider_timeout', '2030-02-10 00:00:02+00'
  )
from hardening_test_results where name = 'cooldown_begin';

insert into hardening_test_results (name, result)
values (
  'cooldown_blocked',
  public.begin_ai_round_request(
    repeat('a', 64), '30000000-0000-4000-8000-000000000002', repeat('2', 64),
    'generate-round', null, null, null, null, null, '2030-02-10 00:00:10+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'cooldown_blocked'), 'rate_limited', 'legacy paid retry is cooled after provider timeout');
select is((select result->>'scope' from hardening_test_results where name = 'cooldown_blocked'), 'legacy_provider_failure_cooldown', 'cooldown has a stable rate-limit scope');
select is((select (result->>'retry_after_seconds')::integer from hardening_test_results where name = 'cooldown_blocked'), 22, 'cooldown reports remaining seconds');
select is((select request_attempts from public.ai_round_usage_daily where scope_type = 'global' and scope_key = '*'), 1::bigint, 'cooldown rejection does not consume request quota');

insert into public.app_attest_keys (
  key_id_hash, public_key_base64, receipt_base64, bundle_id, team_id,
  environment, assertion_counter, created_at, last_seen_at
) values (
  repeat('b', 64), repeat('P', 64), repeat('R', 64),
  'com.example.imposter', 'TEAM123456', 'production', 0,
  '2030-02-10 00:00:00+00', '2030-02-10 00:00:00+00'
);
insert into hardening_test_results (name, result)
values (
  'cooldown_assert_issue',
  public.issue_ai_app_attest_challenge(
    'assert', repeat('a', 64), repeat('b', 64), repeat('3', 64),
    '30000000-0000-4000-8000-000000000003', '2030-02-10 00:00:11+00'
  )
);
insert into hardening_test_results (name, result)
select
  'cooldown_attested_exempt',
  public.begin_ai_round_request(
    repeat('a', 64), '30000000-0000-4000-8000-000000000003', repeat('3', 64),
    'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
    result->>'challenge', 0, 1, '2030-02-10 00:00:12+00'
  )
from hardening_test_results where name = 'cooldown_assert_issue';
select is((select result->>'status' from hardening_test_results where name = 'cooldown_attested_exempt'), 'accepted', 'verified App Attest request is exempt from legacy cooldown');

insert into hardening_test_results (name, result)
values (
  'cooldown_elapsed',
  public.begin_ai_round_request(
    repeat('a', 64), '30000000-0000-4000-8000-000000000004', repeat('4', 64),
    'generate-round', null, null, null, null, null, '2030-02-10 00:00:33+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'cooldown_elapsed'), 'accepted', 'legacy admission resumes after cooldown');

truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into hardening_test_results values (
  'uncertain_begin', public.begin_ai_round_request(
    repeat('a', 64), '31000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-02-11 00:00:00+00'
  )
);
insert into hardening_test_results
select 'uncertain_reserve', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1000, 160, '2030-02-11 00:00:01+00'
)
from hardening_test_results where name = 'uncertain_begin';
insert into hardening_test_results values (
  'uncertain_inflight_retry', public.begin_ai_round_request(
    repeat('a', 64), '31000000-0000-4000-8000-000000000002', repeat('2', 64),
    'generate-round', null, null, null, null, null, '2030-02-11 00:00:10+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'uncertain_inflight_retry'), 'rate_limited', 'different UUID cannot start a second paid legacy call while one is uncertain');
select is((select result->>'scope' from hardening_test_results where name = 'uncertain_inflight_retry'), 'legacy_provider_inflight', 'uncertain in-flight retry has stable scope');
select is((select count(*) from public.ai_model_call_reservations), 1::bigint, 'in-flight guard preserves one provider reservation');

insert into hardening_test_results values (
  'uncertain_after_lease', public.begin_ai_round_request(
    repeat('a', 64), '31000000-0000-4000-8000-000000000003', repeat('3', 64),
    'generate-round', null, null, null, null, null, '2030-02-11 00:00:22+00'
  )
);
select is((select result->>'scope' from hardening_test_results where name = 'uncertain_after_lease'), 'legacy_provider_failure_cooldown', 'abandoned lease-expired provider call enters cooldown');
select is((select status from public.ai_round_executions where idempotency_key = '31000000-0000-4000-8000-000000000001'), 'expired', 'uncertain execution is expired into a tombstone');
select is((select error_code from public.ai_round_executions where idempotency_key = '31000000-0000-4000-8000-000000000001'), 'lease_expired', 'uncertain tombstone records lease expiry');
select is((select status from public.ai_model_call_reservations), 'abandoned', 'uncertain reservation is marked abandoned');

insert into hardening_test_results values (
  'uncertain_cooldown_elapsed', public.begin_ai_round_request(
    repeat('a', 64), '31000000-0000-4000-8000-000000000004', repeat('4', 64),
    'generate-round', null, null, null, null, null, '2030-02-11 00:00:52+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'uncertain_cooldown_elapsed'), 'accepted', 'legacy traffic resumes 30 seconds after uncertain lease expiry');

-- A successful response may be lost after the provider call and database
-- completion. A fresh legacy UUID is still held for the delivery uncertainty
-- window, including an execution admitted before the first call completed.
truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into hardening_test_results values (
  'delivery_begin_a', public.begin_ai_round_request(
    repeat('a', 64), '32000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-02-12 00:00:00+00'
  )
);
insert into hardening_test_results values (
  'delivery_begin_b', public.begin_ai_round_request(
    repeat('a', 64), '32000000-0000-4000-8000-000000000002', repeat('2', 64),
    'generate-round', null, null, null, null, null, '2030-02-12 00:00:01+00'
  )
);
insert into hardening_test_results
select 'delivery_reserve_a', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1000, 160, '2030-02-12 00:00:02+00'
)
from hardening_test_results where name = 'delivery_begin_a';
insert into hardening_test_results
select 'delivery_record_a', public.record_ai_model_call(
  (reserve_result.result->>'call_id')::uuid,
  (begin_result.result->>'execution_id')::uuid,
  (begin_result.result->>'lease_token')::uuid,
  (begin_result.result->>'lease_fence')::bigint,
  'completed', 10, 5, null, '2030-02-12 00:00:03+00'
)
from hardening_test_results reserve_result
cross join hardening_test_results begin_result
where reserve_result.name = 'delivery_reserve_a' and begin_result.name = 'delivery_begin_a';
insert into hardening_test_results
select 'delivery_complete_a', public.complete_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, '{"word":"pear","clue":"fruit"}'::jsonb,
  '2030-02-12 00:00:04+00'
)
from hardening_test_results where name = 'delivery_begin_a';

insert into hardening_test_results
select 'delivery_reserve_b_blocked', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1000, 160, '2030-02-12 00:00:05+00'
)
from hardening_test_results where name = 'delivery_begin_b';
select is((select result->>'status' from hardening_test_results where name = 'delivery_reserve_b_blocked'), 'quota_exhausted', 'pre-admitted legacy retry cannot reserve after a completed call');
select is((select result->>'scope' from hardening_test_results where name = 'delivery_reserve_b_blocked'), 'legacy_provider_completion_cooldown', 'post-success reserve block has stable delivery scope');
select is((select count(*) from public.ai_model_call_reservations), 1::bigint, 'lost-success response path retains one provider call');

insert into hardening_test_results values (
  'delivery_new_uuid_blocked', public.begin_ai_round_request(
    repeat('a', 64), '32000000-0000-4000-8000-000000000003', repeat('3', 64),
    'generate-round', null, null, null, null, null, '2030-02-12 00:00:06+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'delivery_new_uuid_blocked'), 'rate_limited', 'fresh legacy UUID is held after successful delivery uncertainty');
select is((select result->>'scope' from hardening_test_results where name = 'delivery_new_uuid_blocked'), 'legacy_provider_completion_cooldown', 'admission exposes post-success delivery scope');

insert into hardening_test_results values (
  'delivery_cooldown_elapsed', public.begin_ai_round_request(
    repeat('a', 64), '32000000-0000-4000-8000-000000000003', repeat('3', 64),
    'generate-round', null, null, null, null, null, '2030-02-12 00:00:35+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'delivery_cooldown_elapsed'), 'accepted', 'legacy traffic resumes after successful-delivery cooldown');

-- Challenge caps cannot be bypassed by rotating an attacker-controlled
-- registration key ID, and the global hourly cap is independent.
truncate table
  public.app_attest_challenges,
  public.ai_model_call_reservations,
  public.ai_round_active_leases,
  public.ai_round_executions,
  public.app_attest_keys,
  public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set enabled = true,
    attestation_mode = 'observe',
    challenge_hourly_per_key = 20,
    challenge_hourly_global = 2000,
    outstanding_challenges_per_key = 50,
    last_purge_at = '2031-01-01 00:00:00+00';

do $test$
declare
  i integer;
  v_result jsonb;
begin
  for i in 1..21 loop
    v_result := public.issue_ai_app_attest_challenge(
      'attest', repeat('a', 64), lpad(to_hex(i), 64, '0'), null,
      '10000000-0000-4000-8000-' || lpad(i::text, 12, '0'),
      '2030-03-01 00:00:00+00'::timestamptz + make_interval(secs => i)
    );

    if i = 21 then
      insert into hardening_test_results values ('principal_challenge_limit', v_result);
    end if;
  end loop;
end;
$test$;
select is((select result->>'status' from hardening_test_results where name = 'principal_challenge_limit'), 'rate_limited', 'rotating proposed key IDs cannot bypass fingerprint challenge cap');
select is((select result->>'scope' from hardening_test_results where name = 'principal_challenge_limit'), 'principal_or_key_hourly_challenges', 'challenge limit identifies principal-or-key scope');
select is((select count(*) from public.app_attest_challenges), 20::bigint, 'only 20 registration challenges are admitted per fingerprint/hour');

truncate table public.app_attest_challenges, public.app_attest_keys, public.ai_round_usage_daily restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set attested_hourly_requests_per_key = 30,
    challenge_hourly_global = 2000,
    outstanding_challenges_per_key = 5;
insert into public.app_attest_keys (
  key_id_hash, public_key_base64, bundle_id, team_id, environment,
  assertion_counter, created_at, last_seen_at
) values (
  repeat('b', 64), repeat('P', 64), 'com.example.imposter', 'TEAM123456',
  'production', 0, '2030-03-01 00:00:00+00', '2030-03-01 00:00:00+00'
);
do $test$
declare
  i integer;
  v_result jsonb;
begin
  for i in 1..31 loop
    v_result := public.issue_ai_app_attest_challenge(
      'assert', lpad(to_hex(i), 64, '0'), repeat('b', 64),
      lpad(to_hex(i + 64), 64, '0'),
      '11000000-0000-4000-8000-' || lpad(i::text, 12, '0'),
      '2030-03-01 00:10:00+00'::timestamptz + make_interval(secs => i)
    );

    if i <= 30 then
      update public.app_attest_challenges
      set used_at = '2030-03-01 00:20:00+00'
      where challenge_id = (v_result->>'challenge_id')::uuid;
    else
      insert into hardening_test_results values ('attested_challenge_limit', v_result);
    end if;
  end loop;
end;
$test$;
select is((select result->>'status' from hardening_test_results where name = 'attested_challenge_limit'), 'rate_limited', 'attested assertion challenge 31 is rejected');
select is((select result->>'scope' from hardening_test_results where name = 'attested_challenge_limit'), 'attested_hourly_challenges', 'assertion challenge cap follows attested hourly policy');
select is((select count(*) from public.app_attest_challenges), 30::bigint, 'attested key can issue 30 used assertion challenges/hour');

truncate table public.app_attest_challenges, public.app_attest_keys, public.ai_round_usage_daily restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set challenge_hourly_global = 2,
    outstanding_challenges_per_key = 50;

insert into hardening_test_results (name, result)
values ('global_challenge_one', public.issue_ai_app_attest_challenge('attest', repeat('1', 64), repeat('a', 64), null, '20000000-0000-4000-8000-000000000001', '2030-03-01 01:00:01+00'));
insert into hardening_test_results (name, result)
values ('global_challenge_two', public.issue_ai_app_attest_challenge('attest', repeat('2', 64), repeat('b', 64), null, '20000000-0000-4000-8000-000000000002', '2030-03-01 01:00:02+00'));
insert into hardening_test_results (name, result)
values ('global_challenge_three', public.issue_ai_app_attest_challenge('attest', repeat('3', 64), repeat('c', 64), null, '20000000-0000-4000-8000-000000000003', '2030-03-01 01:00:03+00'));
select is((select result->>'status' from hardening_test_results where name = 'global_challenge_three'), 'rate_limited', 'global hourly challenge cap is enforced');
select is((select result->>'scope' from hardening_test_results where name = 'global_challenge_three'), 'global_hourly_challenges', 'global challenge rejection identifies global scope');

-- The backward-compatible v1 RPC cannot exceed the selected legacy hourly cap
-- even if the old caller supplies a larger limit.
truncate table public.ai_round_usage_daily, public.ai_round_request_limits restart identity cascade;
truncate legacy_quota_results;
update public.ai_round_policy
set enabled = true,
    attestation_mode = 'observe',
    challenge_hourly_global = 2000,
    outstanding_challenges_per_key = 5,
    legacy_hourly_requests_per_key = 10,
    legacy_daily_requests_per_key = 30,
    global_daily_requests = 2000,
    last_purge_at = clock_timestamp() + interval '1 day';

do $test$
declare
  i integer;
  v_bucket timestamptz := date_trunc('hour', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  for i in 1..11 loop
    insert into legacy_quota_results
    values (i, public.consume_ai_round_quota(repeat('a', 64), v_bucket, 999));
  end loop;
end;
$test$;
select is((select count(*) from legacy_quota_results where allowed), 10::bigint, 'legacy RPC admits at most ten requests per hour');
select is((select allowed from legacy_quota_results where call_number = 11), false, 'legacy RPC rejects the eleventh hourly request');

-- Selected v2 hourly request ceilings: 10 for legacy, 30 for an App Attest key.
truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set enabled = true, attestation_mode = 'observe',
    legacy_hourly_requests_per_key = 10,
    legacy_daily_requests_per_key = 30,
    global_daily_requests = 2000,
    legacy_concurrency_per_key = 2,
    last_purge_at = '2031-01-01 00:00:00+00';
insert into public.ai_round_request_limits values (
  repeat('a', 64), '2030-04-01 00:00:00+00', 9, '2030-04-01 00:00:00+00'
);
insert into hardening_test_results values (
  'legacy_hourly_tenth',
  public.begin_ai_round_request(
    repeat('a', 64), '40000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-04-01 00:00:01+00'
  )
);
insert into hardening_test_results
select 'legacy_hourly_release', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'cancelled', '2030-04-01 00:00:02+00'
)
from hardening_test_results where name = 'legacy_hourly_tenth';
insert into hardening_test_results values (
  'legacy_hourly_eleventh',
  public.begin_ai_round_request(
    repeat('a', 64), '40000000-0000-4000-8000-000000000002', repeat('2', 64),
    'generate-round', null, null, null, null, null, '2030-04-01 00:00:03+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'legacy_hourly_tenth'), 'accepted', 'legacy request 10 is accepted');
select is((select result->>'scope' from hardening_test_results where name = 'legacy_hourly_eleventh'), 'legacy_hourly_requests', 'legacy request 11 is hourly-limited');

truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set attested_hourly_requests_per_key = 30,
    attested_daily_requests_per_key = 120,
    attested_concurrency_per_key = 1,
    last_purge_at = '2031-01-01 00:00:00+00';
insert into public.app_attest_keys (
  key_id_hash, public_key_base64, bundle_id, team_id, environment,
  assertion_counter, created_at, last_seen_at
) values (
  repeat('b', 64), repeat('P', 64), 'com.example.imposter', 'TEAM123456',
  'production', 0, '2030-04-01 00:00:00+00', '2030-04-01 00:00:00+00'
);
insert into public.ai_round_request_limits values (
  repeat('b', 64), '2030-04-01 01:00:00+00', 29, '2030-04-01 01:00:00+00'
);
insert into hardening_test_results values (
  'attested_hourly_issue_30',
  public.issue_ai_app_attest_challenge(
    'assert', repeat('a', 64), repeat('b', 64), repeat('3', 64),
    '40000000-0000-4000-8000-000000000003', '2030-04-01 01:00:01+00'
  )
);
insert into hardening_test_results
select 'attested_hourly_30', public.begin_ai_round_request(
  repeat('a', 64), '40000000-0000-4000-8000-000000000003', repeat('3', 64),
  'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
  result->>'challenge', 0, 1, '2030-04-01 01:00:02+00'
)
from hardening_test_results where name = 'attested_hourly_issue_30';
insert into hardening_test_results
select 'attested_hourly_release', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'cancelled', '2030-04-01 01:00:03+00'
)
from hardening_test_results where name = 'attested_hourly_30';
insert into hardening_test_results values (
  'attested_hourly_issue_31',
  public.issue_ai_app_attest_challenge(
    'assert', repeat('c', 64), repeat('b', 64), repeat('4', 64),
    '40000000-0000-4000-8000-000000000004', '2030-04-01 01:00:04+00'
  )
);
insert into hardening_test_results
select 'attested_hourly_31', public.begin_ai_round_request(
  repeat('c', 64), '40000000-0000-4000-8000-000000000004', repeat('4', 64),
  'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
  result->>'challenge', 1, 2, '2030-04-01 01:00:05+00'
)
from hardening_test_results where name = 'attested_hourly_issue_31';
select is((select result->>'status' from hardening_test_results where name = 'attested_hourly_30'), 'accepted', 'attested request 30 is accepted');
select is((select result->>'scope' from hardening_test_results where name = 'attested_hourly_31'), 'attested_hourly_requests', 'attested request 31 is hourly-limited');
select is((select assertion_counter from public.app_attest_keys where key_id_hash = repeat('b', 64)), 1::bigint, 'hourly rejection does not consume assertion');

-- Selected daily request ceilings: legacy 30, attested 120, global 2,000.
truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into public.ai_round_usage_daily (
  usage_date, scope_type, scope_key, request_attempts, updated_at
) values
  ('2030-04-02', 'global', '*', 0, '2030-04-02 00:00:00+00'),
  ('2030-04-02', 'client', 'legacy:' || repeat('a', 64), 29, '2030-04-02 00:00:00+00');
insert into hardening_test_results values (
  'legacy_daily_30', public.begin_ai_round_request(
    repeat('a', 64), '41000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-04-02 00:00:01+00'
  )
);
insert into hardening_test_results
select 'legacy_daily_release', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'cancelled', '2030-04-02 00:00:02+00'
)
from hardening_test_results where name = 'legacy_daily_30';
insert into hardening_test_results values (
  'legacy_daily_31', public.begin_ai_round_request(
    repeat('a', 64), '41000000-0000-4000-8000-000000000002', repeat('2', 64),
    'generate-round', null, null, null, null, null, '2030-04-02 00:00:03+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'legacy_daily_30'), 'accepted', 'legacy daily request 30 is accepted');
select is((select result->>'scope' from hardening_test_results where name = 'legacy_daily_31'), 'legacy_daily_requests', 'legacy daily request 31 is rejected');

truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into public.app_attest_keys (
  key_id_hash, public_key_base64, bundle_id, team_id, environment,
  assertion_counter, created_at, last_seen_at
) values (
  repeat('b', 64), repeat('P', 64), 'com.example.imposter', 'TEAM123456',
  'production', 0, '2030-04-02 01:00:00+00', '2030-04-02 01:00:00+00'
);
insert into public.ai_round_usage_daily (
  usage_date, scope_type, scope_key, request_attempts, updated_at
) values
  ('2030-04-02', 'global', '*', 0, '2030-04-02 01:00:00+00'),
  ('2030-04-02', 'client', 'attested:' || repeat('b', 64), 119, '2030-04-02 01:00:00+00');
insert into hardening_test_results values (
  'attested_daily_issue_120', public.issue_ai_app_attest_challenge(
    'assert', repeat('a', 64), repeat('b', 64), repeat('3', 64),
    '41000000-0000-4000-8000-000000000003', '2030-04-02 01:00:01+00'
  )
);
insert into hardening_test_results
select 'attested_daily_120', public.begin_ai_round_request(
  repeat('a', 64), '41000000-0000-4000-8000-000000000003', repeat('3', 64),
  'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
  result->>'challenge', 0, 1, '2030-04-02 01:00:02+00'
)
from hardening_test_results where name = 'attested_daily_issue_120';
insert into hardening_test_results
select 'attested_daily_release', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'cancelled', '2030-04-02 01:00:03+00'
)
from hardening_test_results where name = 'attested_daily_120';
insert into hardening_test_results values (
  'attested_daily_issue_121', public.issue_ai_app_attest_challenge(
    'assert', repeat('c', 64), repeat('b', 64), repeat('4', 64),
    '41000000-0000-4000-8000-000000000004', '2030-04-02 01:00:04+00'
  )
);
insert into hardening_test_results
select 'attested_daily_121', public.begin_ai_round_request(
  repeat('c', 64), '41000000-0000-4000-8000-000000000004', repeat('4', 64),
  'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
  result->>'challenge', 1, 2, '2030-04-02 01:00:05+00'
)
from hardening_test_results where name = 'attested_daily_issue_121';
select is((select result->>'status' from hardening_test_results where name = 'attested_daily_120'), 'accepted', 'attested daily request 120 is accepted');
select is((select result->>'scope' from hardening_test_results where name = 'attested_daily_121'), 'attested_daily_requests', 'attested daily request 121 is rejected');

truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into public.ai_round_usage_daily (
  usage_date, scope_type, scope_key, request_attempts, updated_at
) values ('2030-04-03', 'global', '*', 1999, '2030-04-03 00:00:00+00');
insert into hardening_test_results values (
  'global_daily_2000', public.begin_ai_round_request(
    repeat('a', 64), '42000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-04-03 00:00:01+00'
  )
);
insert into hardening_test_results
select 'global_daily_release', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'cancelled', '2030-04-03 00:00:02+00'
)
from hardening_test_results where name = 'global_daily_2000';
insert into hardening_test_results values (
  'global_daily_2001', public.begin_ai_round_request(
    repeat('b', 64), '42000000-0000-4000-8000-000000000002', repeat('2', 64),
    'generate-round', null, null, null, null, null, '2030-04-03 00:00:03+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'global_daily_2000'), 'accepted', 'global daily request 2,000 is accepted');
select is((select result->>'scope' from hardening_test_results where name = 'global_daily_2001'), 'global_daily_requests', 'global daily request 2,001 is rejected');

-- Selected model-call ceilings: legacy 30, attested 120, global 2,000.
truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into public.ai_round_usage_daily (
  usage_date, scope_type, scope_key, model_calls_reserved, updated_at
) values
  ('2030-04-04', 'global', '*', 0, '2030-04-04 00:00:00+00'),
  ('2030-04-04', 'client', 'legacy:' || repeat('a', 64), 29, '2030-04-04 00:00:00+00');
insert into hardening_test_results values (
  'legacy_model_begin_30', public.begin_ai_round_request(
    repeat('a', 64), '43000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-04-04 00:00:01+00'
  )
);
insert into hardening_test_results
select 'legacy_model_30', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-04 00:00:02+00'
)
from hardening_test_results where name = 'legacy_model_begin_30';
insert into hardening_test_results
select 'legacy_model_release', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'cancelled', '2030-04-04 00:00:03+00'
)
from hardening_test_results where name = 'legacy_model_begin_30';
insert into hardening_test_results values (
  'legacy_model_begin_31', public.begin_ai_round_request(
    repeat('a', 64), '43000000-0000-4000-8000-000000000002', repeat('2', 64),
    'generate-round', null, null, null, null, null, '2030-04-04 00:00:04+00'
  )
);
insert into hardening_test_results
select 'legacy_model_31', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-04 00:00:05+00'
)
from hardening_test_results where name = 'legacy_model_begin_31';
select is((select result->>'status' from hardening_test_results where name = 'legacy_model_30'), 'reserved', 'legacy model call 30 is reserved');
select is((select result->>'scope' from hardening_test_results where name = 'legacy_model_31'), 'legacy_daily_model_calls', 'legacy model call 31 is rejected');

truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into public.app_attest_keys (
  key_id_hash, public_key_base64, bundle_id, team_id, environment,
  assertion_counter, created_at, last_seen_at
) values (
  repeat('b', 64), repeat('P', 64), 'com.example.imposter', 'TEAM123456',
  'production', 0, '2030-04-04 01:00:00+00', '2030-04-04 01:00:00+00'
);
insert into public.ai_round_usage_daily (
  usage_date, scope_type, scope_key, model_calls_reserved, updated_at
) values
  ('2030-04-04', 'global', '*', 0, '2030-04-04 01:00:00+00'),
  ('2030-04-04', 'client', 'attested:' || repeat('b', 64), 119, '2030-04-04 01:00:00+00');
insert into hardening_test_results values (
  'attested_model_issue_120', public.issue_ai_app_attest_challenge(
    'assert', repeat('a', 64), repeat('b', 64), repeat('3', 64),
    '43000000-0000-4000-8000-000000000003', '2030-04-04 01:00:01+00'
  )
);
insert into hardening_test_results
select 'attested_model_begin_120', public.begin_ai_round_request(
  repeat('a', 64), '43000000-0000-4000-8000-000000000003', repeat('3', 64),
  'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
  result->>'challenge', 0, 1, '2030-04-04 01:00:02+00'
)
from hardening_test_results where name = 'attested_model_issue_120';
insert into hardening_test_results
select 'attested_model_120', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-04 01:00:03+00'
)
from hardening_test_results where name = 'attested_model_begin_120';
insert into hardening_test_results
select 'attested_model_release', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'cancelled', '2030-04-04 01:00:04+00'
)
from hardening_test_results where name = 'attested_model_begin_120';
insert into hardening_test_results values (
  'attested_model_issue_121', public.issue_ai_app_attest_challenge(
    'assert', repeat('c', 64), repeat('b', 64), repeat('4', 64),
    '43000000-0000-4000-8000-000000000004', '2030-04-04 01:00:05+00'
  )
);
insert into hardening_test_results
select 'attested_model_begin_121', public.begin_ai_round_request(
  repeat('c', 64), '43000000-0000-4000-8000-000000000004', repeat('4', 64),
  'generate-round', repeat('b', 64), (result->>'challenge_id')::uuid,
  result->>'challenge', 1, 2, '2030-04-04 01:00:06+00'
)
from hardening_test_results where name = 'attested_model_issue_121';
insert into hardening_test_results
select 'attested_model_121', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-04 01:00:07+00'
)
from hardening_test_results where name = 'attested_model_begin_121';
select is((select result->>'status' from hardening_test_results where name = 'attested_model_120'), 'reserved', 'attested model call 120 is reserved');
select is((select result->>'scope' from hardening_test_results where name = 'attested_model_121'), 'attested_daily_model_calls', 'attested model call 121 is rejected');

truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into public.ai_round_usage_daily (
  usage_date, scope_type, scope_key, model_calls_reserved, updated_at
) values ('2030-04-05', 'global', '*', 1999, '2030-04-05 00:00:00+00');
insert into hardening_test_results values (
  'global_model_begin_2000', public.begin_ai_round_request(
    repeat('a', 64), '44000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-04-05 00:00:01+00'
  )
);
insert into hardening_test_results
select 'global_model_2000', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-05 00:00:02+00'
)
from hardening_test_results where name = 'global_model_begin_2000';
insert into hardening_test_results
select 'global_model_release', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'cancelled', '2030-04-05 00:00:03+00'
)
from hardening_test_results where name = 'global_model_begin_2000';
insert into hardening_test_results values (
  'global_model_begin_2001', public.begin_ai_round_request(
    repeat('b', 64), '44000000-0000-4000-8000-000000000002', repeat('2', 64),
    'generate-round', null, null, null, null, null, '2030-04-05 00:00:04+00'
  )
);
insert into hardening_test_results
select 'global_model_2001', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-05 00:00:05+00'
)
from hardening_test_results where name = 'global_model_begin_2001';
select is((select result->>'status' from hardening_test_results where name = 'global_model_2000'), 'reserved', 'global model call 2,000 is reserved');
select is((select result->>'scope' from hardening_test_results where name = 'global_model_2001'), 'global_daily_model_calls', 'global model call 2,001 is rejected');

-- Cost units are micro-USD. Exactly $25 may be reserved; a single larger
-- reservation is invalid and additional daily cost is rejected atomically.
truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set global_daily_model_calls = 2000,
    legacy_daily_model_calls_per_key = 30,
    global_daily_cost_microusd = 25000000,
    daily_cost_microusd_per_key = 25000000,
    last_purge_at = '2031-01-01 00:00:00+00';
insert into hardening_test_results values (
  'cost_begin', public.begin_ai_round_request(
    repeat('a', 64), '45000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-04-06 00:00:01+00'
  )
);
insert into hardening_test_results
select 'cost_over_single', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  25000001, 160, '2030-04-06 00:00:02+00'
)
from hardening_test_results where name = 'cost_begin';
insert into hardening_test_results
select 'cost_exact_boundary', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  25000000, 160, '2030-04-06 00:00:03+00'
)
from hardening_test_results where name = 'cost_begin';
select is((select result->>'status' from hardening_test_results where name = 'cost_over_single'), 'invalid_request', 'reservation above $25 is invalid');
select is((select result->>'status' from hardening_test_results where name = 'cost_exact_boundary'), 'reserved', 'exact $25 micro-USD boundary is reservable');
select is((select cost_microusd_reserved from public.ai_round_usage_daily where scope_type = 'global' and scope_key = '*'), 25000000::bigint, 'cost boundary is charged exactly once');

insert into hardening_test_results values (
  'cost_second_begin', public.begin_ai_round_request(
    repeat('b', 64), '45000000-0000-4000-8000-000000000002', repeat('2', 64),
    'generate-round', null, null, null, null, null, '2030-04-06 00:00:04+00'
  )
);
insert into hardening_test_results
select 'cost_global_over', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-06 00:00:05+00'
)
from hardening_test_results where name = 'cost_second_begin';
select is((select result->>'scope' from hardening_test_results where name = 'cost_global_over'), 'global_daily_cost_microusd', 'cost above global daily boundary is rejected');

truncate table
  public.ai_model_call_reservations, public.ai_round_active_leases,
  public.ai_round_executions, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set global_daily_cost_microusd = 50000000,
    daily_cost_microusd_per_key = 25000000;
insert into hardening_test_results values (
  'client_cost_begin_one', public.begin_ai_round_request(
    repeat('a', 64), '45000000-0000-4000-8000-000000000003', repeat('3', 64),
    'generate-round', null, null, null, null, null, '2030-04-06 01:00:01+00'
  )
);
insert into hardening_test_results
select 'client_cost_exact', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  25000000, 160, '2030-04-06 01:00:02+00'
)
from hardening_test_results where name = 'client_cost_begin_one';
insert into hardening_test_results
select 'client_cost_release', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'cancelled', '2030-04-06 01:00:03+00'
)
from hardening_test_results where name = 'client_cost_begin_one';
insert into hardening_test_results values (
  'client_cost_begin_two', public.begin_ai_round_request(
    repeat('a', 64), '45000000-0000-4000-8000-000000000004', repeat('4', 64),
    'generate-round', null, null, null, null, null, '2030-04-06 01:00:04+00'
  )
);
insert into hardening_test_results
select 'client_cost_over', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-06 01:00:05+00'
)
from hardening_test_results where name = 'client_cost_begin_two';
select is((select result->>'scope' from hardening_test_results where name = 'client_cost_over'), 'legacy_daily_cost_microusd', 'cost above per-principal daily boundary is rejected');

-- Deterministic concurrency caps and lease expiry recovery. True multi-session
-- races remain an integration gate, while policy-row locking serializes these.
truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set global_daily_cost_microusd = 25000000,
    daily_cost_microusd_per_key = 25000000,
    global_concurrency = 8,
    legacy_concurrency_per_key = 2,
    last_purge_at = '2031-01-01 00:00:00+00';
do $test$
declare
  i integer;
  v_result jsonb;
begin
  for i in 1..9 loop
    v_result := public.begin_ai_round_request(
      lpad(to_hex(i), 64, '0'),
      '46000000-0000-4000-8000-' || lpad(i::text, 12, '0'),
      lpad(to_hex(i + 32), 64, '0'), 'generate-round',
      null, null, null, null, null, '2030-04-07 00:00:00+00'
    );
    insert into hardening_test_results values ('global_concurrency_' || i, v_result);
  end loop;
end;
$test$;
select is((select count(*) from hardening_test_results where name like 'global_concurrency_%' and result->>'status' = 'accepted'), 8::bigint, 'global concurrency admits exactly eight leases');
select is((select result->>'scope' from hardening_test_results where name = 'global_concurrency_9'), 'global', 'ninth global lease is concurrency-limited');
insert into hardening_test_results values (
  'global_concurrency_after_expiry', public.begin_ai_round_request(
    lpad(to_hex(9), 64, '0'), '46000000-0000-4000-8000-000000000009',
    lpad(to_hex(41), 64, '0'), 'generate-round', null, null, null, null, null,
    '2030-04-07 00:00:21+00'
  )
);
select is((select result->>'status' from hardening_test_results where name = 'global_concurrency_after_expiry'), 'accepted', 'expired global leases free capacity');
select is((select count(*) from public.ai_round_executions where status = 'expired'), 8::bigint, 'expired leases become retained execution tombstones');

truncate table
  public.ai_round_active_leases, public.ai_round_executions,
  public.ai_round_usage_daily, public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into hardening_test_results values
  ('principal_concurrency_1', public.begin_ai_round_request(repeat('a', 64), '47000000-0000-4000-8000-000000000001', repeat('1', 64), 'generate-round', null, null, null, null, null, '2030-04-07 01:00:00+00'));
insert into hardening_test_results values
  ('principal_concurrency_2', public.begin_ai_round_request(repeat('a', 64), '47000000-0000-4000-8000-000000000002', repeat('2', 64), 'generate-round', null, null, null, null, null, '2030-04-07 01:00:01+00'));
insert into hardening_test_results values
  ('principal_concurrency_3', public.begin_ai_round_request(repeat('a', 64), '47000000-0000-4000-8000-000000000003', repeat('3', 64), 'generate-round', null, null, null, null, null, '2030-04-07 01:00:02+00'));
select is((select result->>'status' from hardening_test_results where name = 'principal_concurrency_1'), 'accepted', 'first legacy principal lease is accepted');
select is((select result->>'status' from hardening_test_results where name = 'principal_concurrency_2'), 'accepted', 'second legacy principal lease is accepted');
select is((select result->>'scope' from hardening_test_results where name = 'principal_concurrency_3'), 'legacy', 'third same-principal lease is limited');

insert into hardening_test_results
select 'principal_reserve_first', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-07 01:00:03+00'
)
from hardening_test_results where name = 'principal_concurrency_1';
insert into hardening_test_results
select 'principal_reserve_second_blocked', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-07 01:00:04+00'
)
from hardening_test_results where name = 'principal_concurrency_2';
select is((select result->>'status' from hardening_test_results where name = 'principal_reserve_first'), 'reserved', 'first of two admitted legacy leases gets provider permission');
select is((select result->>'status' from hardening_test_results where name = 'principal_reserve_second_blocked'), 'quota_exhausted', 'second admitted legacy lease cannot reserve concurrently');
select is((select result->>'scope' from hardening_test_results where name = 'principal_reserve_second_blocked'), 'legacy_provider_inflight', 'reservation race closes with stable in-flight scope');
select is((select count(*) from public.ai_model_call_reservations), 1::bigint, 'begin-before-reserve race still creates one provider reservation');

insert into hardening_test_results
select 'principal_first_failure', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'provider_failure', '2030-04-07 01:00:05+00'
)
from hardening_test_results where name = 'principal_concurrency_1';
insert into hardening_test_results
select 'principal_reserve_second_cooldown', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-07 01:00:06+00'
)
from hardening_test_results where name = 'principal_concurrency_2';
select is((select result->>'status' from hardening_test_results where name = 'principal_reserve_second_cooldown'), 'quota_exhausted', 'pre-admitted second lease cannot bypass failure cooldown');
select is((select result->>'scope' from hardening_test_results where name = 'principal_reserve_second_cooldown'), 'legacy_provider_failure_cooldown', 'reservation recheck exposes failure cooldown scope');
select is((select count(*) from public.ai_model_call_reservations), 1::bigint, 'failure cooldown preserves one provider attempt');

truncate table
  public.ai_model_call_reservations, public.ai_round_active_leases,
  public.ai_round_executions, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
insert into hardening_test_results values (
  'lease_begin', public.begin_ai_round_request(
    repeat('a', 64), '48000000-0000-4000-8000-000000000001', repeat('1', 64),
    'generate-round', null, null, null, null, null, '2030-04-07 02:00:00+00'
  )
);
insert into hardening_test_results
select 'lease_reserve', public.reserve_ai_model_call(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'generation', 1, 'gpt-5.4-mini',
  1, 1, '2030-04-07 02:00:01+00'
)
from hardening_test_results where name = 'lease_begin';
insert into hardening_test_results
select 'lease_stale_record', public.record_ai_model_call(
  (reserve_result.result->>'call_id')::uuid,
  (begin_result.result->>'execution_id')::uuid,
  (begin_result.result->>'lease_token')::uuid,
  (begin_result.result->>'lease_fence')::bigint,
  'completed', 1, 1, null, '2030-04-07 02:00:22+00'
)
from hardening_test_results reserve_result
cross join hardening_test_results begin_result
where reserve_result.name = 'lease_reserve' and begin_result.name = 'lease_begin';
insert into hardening_test_results
select 'lease_stale_fail', public.fail_ai_round_request(
  (result->>'execution_id')::uuid, (result->>'lease_token')::uuid,
  (result->>'lease_fence')::bigint, 'provider_timeout', '2030-04-07 02:00:22+00'
)
from hardening_test_results where name = 'lease_begin';
select is((select result->>'status' from hardening_test_results where name = 'lease_stale_record'), 'lease_invalid', 'expired lease cannot record provider result');
select is((select result->>'status' from hardening_test_results where name = 'lease_stale_fail'), 'lease_invalid', 'expired lease cannot overwrite execution failure');

-- Cleanup horizons: challenges 1 day past expiry; executions/model calls 7
-- days; client/hourly 31 days; global 400 days; revoked keys 90 days.
truncate table
  public.app_attest_challenges, public.ai_model_call_reservations,
  public.ai_round_active_leases, public.ai_round_executions,
  public.app_attest_keys, public.ai_round_usage_daily,
  public.ai_round_request_limits
restart identity cascade;
truncate hardening_test_results;
update public.ai_round_policy
set client_usage_retention_days = 31,
    global_usage_retention_days = 400,
    execution_retention_days = 7,
    model_call_retention_days = 7,
    revoked_key_retention_days = 90,
    hourly_retention_days = 31,
    last_purge_at = '2039-01-01 00:00:00+00';

insert into public.app_attest_challenges (
  challenge_id, challenge_hash, challenge_value, purpose, request_key_hash,
  key_id_hash, payload_hash, idempotency_key, created_at, expires_at
) values
  ('50000000-0000-4000-8000-000000000001', repeat('1', 64), repeat('A', 43), 'attest', repeat('1', 64), repeat('a', 64), null, '50000000-0000-4000-8000-000000000001', '2039-12-29 22:00:00+00', '2039-12-30 22:00:00+00'),
  ('50000000-0000-4000-8000-000000000002', repeat('2', 64), repeat('B', 43), 'attest', repeat('2', 64), repeat('b', 64), null, '50000000-0000-4000-8000-000000000002', '2039-12-31 20:00:00+00', '2039-12-31 23:00:00+00');

insert into public.ai_round_executions (
  execution_id, request_key_hash, idempotency_key, payload_hash, mode,
  attestation_class, status, lease_token, lease_fence, usage_date,
  model_calls_reserved, created_at, updated_at, completed_at, retain_until
) values
  ('51000000-0000-4000-8000-000000000001', repeat('3', 64), '51000000-0000-4000-8000-000000000001', repeat('3', 64), 'generate-round', 'legacy', 'failed', '52000000-0000-4000-8000-000000000001', 1, '2039-12-20', 1, '2039-12-20 00:00:00+00', '2039-12-20 00:00:00+00', '2039-12-20 00:00:00+00', '2039-12-28 00:00:00+00'),
  ('51000000-0000-4000-8000-000000000002', repeat('4', 64), '51000000-0000-4000-8000-000000000002', repeat('4', 64), 'generate-round', 'legacy', 'completed', '52000000-0000-4000-8000-000000000002', 1, '2039-12-20', 1, '2039-12-20 00:00:00+00', '2039-12-20 00:00:00+00', '2039-12-20 00:00:00+00', '2040-01-02 00:00:00+00');
update public.ai_round_executions
set response = '{"word":"old"}'::jsonb,
    response_expires_at = '2039-12-31 00:00:00+00'
where execution_id = '51000000-0000-4000-8000-000000000002';
insert into public.ai_model_call_reservations (
  call_id, execution_id, lease_token, lease_fence, stage, attempt, model,
  reserved_cost_microusd, max_output_tokens, usage_date, status, started_at, finished_at
) values
  ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 1, 'generation', 1, 'gpt-5.4-mini', 1, 1, '2039-12-20', 'failed', '2039-12-20 00:00:00+00', '2039-12-20 00:00:01+00'),
  ('53000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000002', 1, 'generation', 1, 'gpt-5.4-mini', 1, 1, '2039-12-20', 'completed', '2039-12-20 00:00:00+00', '2039-12-20 00:00:01+00');

insert into public.ai_round_usage_daily (usage_date, scope_type, scope_key, updated_at) values
  ('2039-11-29', 'client', 'legacy:' || repeat('1', 64), '2039-11-29 00:00:00+00'),
  ('2039-12-01', 'client', 'legacy:' || repeat('2', 64), '2039-12-01 00:00:00+00'),
  ('2038-11-26', 'global', '*', '2038-11-26 00:00:00+00'),
  ('2038-11-27', 'global', '*', '2038-11-27 00:00:00+00');
insert into public.ai_round_request_limits values
  (repeat('1', 64), '2039-11-29 00:00:00+00', 1, '2039-11-29 00:00:00+00'),
  (repeat('2', 64), '2039-12-01 00:00:00+00', 1, '2039-12-01 00:00:00+00');
insert into public.app_attest_keys (
  key_id_hash, public_key_base64, bundle_id, team_id, environment, status,
  created_at, last_seen_at, revoked_at
) values
  (repeat('c', 64), repeat('P', 64), 'com.example.imposter', 'TEAM123456', 'production', 'revoked', '2039-01-01 00:00:00+00', '2039-09-01 00:00:00+00', '2039-09-30 00:00:00+00'),
  (repeat('d', 64), repeat('P', 64), 'com.example.imposter', 'TEAM123456', 'production', 'revoked', '2039-01-01 00:00:00+00', '2039-10-03 00:00:00+00', '2039-10-03 00:00:00+00');

insert into hardening_test_results values (
  'retention_purge', public.purge_ai_round_control(50000, '2040-01-01 00:00:00+00')
);
select is((select count(*) from public.app_attest_challenges where challenge_id = '50000000-0000-4000-8000-000000000001'), 0::bigint, 'challenge older than expiry plus one day is deleted');
select is((select count(*) from public.app_attest_challenges where challenge_id = '50000000-0000-4000-8000-000000000002'), 1::bigint, 'recently expired challenge is retained');
select is((select count(*) from public.ai_round_executions where execution_id = '51000000-0000-4000-8000-000000000001'), 0::bigint, 'expired execution tombstone is deleted after seven days');
select is((select count(*) from public.ai_model_call_reservations where call_id = '53000000-0000-4000-8000-000000000001'), 0::bigint, 'model reservation is deleted with expired tombstone');
select is((select count(*) from public.ai_model_call_reservations where call_id = '53000000-0000-4000-8000-000000000002'), 1::bigint, 'model reservation remains while execution tombstone is retained');
select ok((select response is null from public.ai_round_executions where execution_id = '51000000-0000-4000-8000-000000000002'), 'expired cached response is cleared independently');
select is((select count(*) from public.ai_round_usage_daily where scope_type = 'client' and usage_date = '2039-11-29'), 0::bigint, 'client usage older than 31 days is deleted');
select is((select count(*) from public.ai_round_usage_daily where scope_type = 'client' and usage_date = '2039-12-01'), 1::bigint, 'client usage at 31-day boundary is retained');
select is((select count(*) from public.ai_round_usage_daily where scope_type = 'global' and usage_date = '2038-11-26'), 0::bigint, 'global usage older than 400 days is deleted');
select is((select count(*) from public.ai_round_usage_daily where scope_type = 'global' and usage_date = '2038-11-27'), 1::bigint, 'global usage at 400-day boundary is retained');
select is((select count(*) from public.ai_round_request_limits where bucket_start = '2039-11-29 00:00:00+00'), 0::bigint, 'legacy hourly row older than 31 days is deleted');
select is((select count(*) from public.ai_round_request_limits where bucket_start = '2039-12-01 00:00:00+00'), 1::bigint, 'legacy hourly row at 31-day boundary is retained');
select is((select count(*) from public.app_attest_keys where key_id_hash = repeat('c', 64)), 0::bigint, 'revoked key older than 90 days is deleted');
select is((select count(*) from public.app_attest_keys where key_id_hash = repeat('d', 64)), 1::bigint, 'recent revoked key is retained');

select * from finish();
rollback;
