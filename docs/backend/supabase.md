# Supabase Backend

The production backend is the `generate-round` Supabase Edge Function:

```txt
https://wqryrqffcldnpubcgtyh.supabase.co/functions/v1/generate-round
```

It keeps provider and Supabase secrets server-side. Postgres owns the emergency switch, request and cost quotas, concurrency leases, idempotency records, App Attest state, and retention cleanup. The function also honors `AI_ROUND_HARD_DISABLED=true` as an independent emergency stop.

## What you need to do

1. Start Docker and run the local database and function tests.
2. Link the repository to the intended Supabase project and inspect remote migration history.
3. Push migrations before deploying the function.
4. Set server-only Edge Function secrets.
5. Deploy only `generate-round`, then verify its version and the remote schema.
6. Set the app's public production URL to the deployed function URL.

## Commands

Run these from the repo root:

```bash
npx supabase login
npx supabase link --project-ref wqryrqffcldnpubcgtyh
npx supabase db push --dry-run
npx supabase db push
npx supabase secrets set OPENAI_API_KEY=<your-openai-key>
npx supabase secrets set OPENAI_MODEL=gpt-5.4-mini
npx supabase secrets set OPENAI_LOCALIZED_GENERATION_MODEL=gpt-5.4
npx supabase secrets set OPENAI_TRANSLATION_MODEL=gpt-5.4
npx supabase secrets set AI_ROUND_RATE_LIMIT_SALT=<random-long-string>
npx supabase secrets set AI_ROUND_HARD_DISABLED=false
npx supabase secrets set APPLE_APP_ID_PREFIX=<your-apple-app-id-prefix>
npx supabase secrets set APPLE_TEAM_ID=<your-apple-developer-team-id>
npx supabase secrets set APPLE_BUNDLE_ID=com.cnfstudios.imposter
npx supabase secrets set APP_ATTEST_ENVIRONMENT=production
npx supabase secrets set APP_ATTEST_ALLOWED_BUNDLE_VERSIONS=3
npx supabase secrets set APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES=2,4
npx supabase secrets set APP_ATTEST_REQUIRE_IDENTITY_EXTENSIONS=false
npx supabase functions deploy generate-round
npx supabase db lint --linked --schema public --level error --fail-on error
npx supabase functions list
```

Do not change model secrets casually: only allowlisted models with configured cost data are accepted. Keep a provider-project budget as defense in depth; the database's seeded daily reservation ceiling is $25 and is intentionally conservative rather than an invoice guarantee.

For local function testing, create `supabase/functions/.env` from `supabase/functions/.env.example`, then run:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
npx supabase functions serve generate-round --env-file supabase/functions/.env
```

Local function URL:

```txt
http://127.0.0.1:54321/functions/v1/generate-round
```

Production app env:

```bash
EXPO_PUBLIC_AI_ROUND_API_URL=https://wqryrqffcldnpubcgtyh.supabase.co/functions/v1/generate-round
```

Only `EXPO_PUBLIC_AI_ROUND_API_URL` belongs in the mobile environment. Never put `OPENAI_API_KEY`, model configuration, Apple identifiers used for validation, Supabase service-role keys, or `AI_ROUND_RATE_LIMIT_SALT` in Expo public variables.

## Emergency controls

The fastest database kill switch is:

```sql
update public.ai_round_policy
set enabled = false,
    updated_at = clock_timestamp()
where singleton = true;
```

Re-enable it only after the incident is understood:

```sql
update public.ai_round_policy
set enabled = true,
    updated_at = clock_timestamp()
where singleton = true;
```

`AI_ROUND_HARD_DISABLED=true` overrides the database and blocks new paid provider calls even if the policy row is enabled. Changing either control does not require a mobile release. Already-started provider calls cannot be recalled.

## App Attest rollout

The seeded policy uses `observe`, so submitted clients without App Attest remain on the lower legacy quota. Do not set the policy to `required` until a signed physical-device build has completed development and TestFlight validation. App Attest is unavailable in the iOS Simulator.

The initial validation settings intentionally support the submitted build while rollout is observed. Set `APP_ATTEST_ALLOWED_BUNDLE_VERSIONS` to a comma-separated allowlist of deployed iOS build numbers. Production validation categories default to `2,4`; development defaults to `3`. Keep `APP_ATTEST_REQUIRE_IDENTITY_EXTENSIONS=false` until real App Store/TestFlight proofs have been checked, then tighten it only after confirming the extensions emitted by supported OS versions.

The Apple App ID prefix is usually the team identifier but must be copied from the registered App ID, not guessed. App Attest keys are anonymous per-install keys; this backend does not create user accounts.

## Retention

The migration schedules hourly cleanup for expired challenges, leases, idempotency results, model reservations, and old rate-limit rows. When `pg_cron` is unavailable, request admission invokes the same bounded cleanup under an advisory lock. Active App Attest keys are retained until revoked because they must survive ordinary app updates.

## Policy operations

Inspect the singleton before changing it:

```sql
select * from public.ai_round_policy where singleton = true;
```

The seeded global reservation ceiling is 25,000,000 micro-USD ($25) per UTC day. The same row controls global and per-principal request/model-call quotas, concurrency, the 20-second execution lease, the legacy provider cooldown (covering in-flight, failed, expired, abandoned, and recently completed calls), retention, and `off | observe | required` attestation mode. Apply policy changes through a reviewed SQL migration or an audited production runbook, update `updated_at`, and never expose direct table or RPC access to mobile clients.

`APP_ATTEST_REQUIRE_IDENTITY_EXTENSIONS=false` is a rollout compatibility setting, not the final enforcement target. Before moving `attestation_mode` to `required`, validate physical-device fixtures for every allowed production build and then enable identity-extension checks if all supported OS versions provide them.
