# Supabase Backend

The production backend is a Supabase Edge Function:

```txt
https://wqryrqffcldnpubcgtyh.supabase.co/functions/v1/generate-round
```

It keeps the OpenAI key server-side, validates all requests and model output, and uses Postgres to rate-limit requests by hashed client key.

## What you need to do

1. Create a Supabase project at https://database.new.
2. Make sure Docker is running if you want to test locally.
3. Use the Supabase CLI through `npx` or install it with your preferred supported method.
4. Link this repo to your Supabase project.
5. Push the database migration.
6. Set the Edge Function secrets.
7. Deploy the `generate-round` function.
8. Set the app's production `EXPO_PUBLIC_AI_ROUND_API_URL` to the deployed function URL.

## Commands

Run these from the repo root:

```bash
npx supabase login
npx supabase link --project-ref wqryrqffcldnpubcgtyh
npx supabase db push
npx supabase secrets set OPENAI_API_KEY=<your-openai-key>
npx supabase secrets set OPENAI_MODEL=gpt-5.4-mini
npx supabase secrets set AI_ROUND_RATE_LIMIT_PER_HOUR=60
npx supabase secrets set AI_ROUND_RATE_LIMIT_SALT=<random-long-string>
npx supabase functions deploy generate-round
```

For local function testing, create `supabase/functions/.env` from `supabase/functions/.env.example`, then run:

```bash
npx supabase start
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

Do not put `OPENAI_API_KEY`, Supabase service-role keys, or `AI_ROUND_RATE_LIMIT_SALT` in Expo public env vars.
